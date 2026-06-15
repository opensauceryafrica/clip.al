import { createRedis, keys, redis } from '@clipal/cache';
import { captureException } from '@clipal/observability';
import { createLink, type PowerLinkConfig } from '@clipal/shorten';

/**
 * Bulk CSV import (§8/AC7). Drains the `bulk:imports` stream with a consumer
 * group (mirroring click-ingest), creating one link per row via `createLink` —
 * which runs the FULL safety pipeline (SSRF + blocklist + Google Safe Browsing).
 *
 * Throughput is deliberately throttled to ~50 rows/sec so the per-row Safe
 * Browsing lookups aren't swamped. Each processed row HINCRBYs the per-import
 * progress hash (done + ok|failed); the SSE route polls that hash. A row that
 * fails 3× (an unexpected error, not a clean rejection) is routed to the DLQ and
 * acked so it can't block the stream head.
 */
const STREAM = keys.bulkStream;
const GROUP = 'bulk-cg';
const CONSUMER = `worker-${process.pid}`;
const BATCH = 50;
const MAX_ATTEMPTS = 3;
const ROWS_PER_SEC = 50;
const ROW_DELAY_MS = Math.ceil(1000 / ROWS_PER_SEC);

type StreamEntry = [id: string, fields: string[]];

const attempts = new Map<string, number>();
// Dedicated connection for the blocking XREADGROUP (must not share the pool).
const blocking = createRedis({ maxRetriesPerRequest: null });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function fieldsToRecord(arr: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < arr.length; i += 2) {
    const key = arr[i];
    if (key !== undefined) out[key] = arr[i + 1] ?? '';
  }
  return out;
}

async function ensureGroup(): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
  }
}

async function sendToDlq(fields: string[], reason: string): Promise<void> {
  await redis.xadd(keys.bulkDlq, 'MAXLEN', '~', 100_000, '*', ...fields, '_error', reason);
}

/** Record one finished row against the import's progress hash (best-effort). */
async function tickProgress(importId: string, succeeded: boolean): Promise<void> {
  if (!importId) return;
  const key = keys.bulkProgress(importId);
  try {
    await redis.hincrby(key, 'done', 1);
    await redis.hincrby(key, succeeded ? 'ok' : 'failed', 1);

    // Flip status to 'done' once every row is accounted for, so the SSE stream
    // (and a resumed poll after the hash TTL) terminates cleanly.
    const h = (await redis.hgetall(key)) as Record<string, string>;
    const total = Number(h['total'] ?? 0);
    const done = Number(h['done'] ?? 0);
    if (total > 0 && done >= total && h['status'] !== 'done') {
      await redis.hset(key, 'status', 'done');
    }
  } catch (err) {
    console.error('[bulk-import] progress update failed', err);
  }
}

/**
 * Process one row. Returns true if the row was handled (created OR cleanly
 * rejected by safety) and should be ACKed; false if it hit an unexpected error
 * and should be retried/DLQ'd.
 */
async function processRow(fieldArr: string[]): Promise<boolean> {
  const f = fieldsToRecord(fieldArr);
  const importId = f['importId'] ?? '';
  const ownerId = f['ownerId'] ?? '';
  const destination = f['destination_url'] ?? '';

  if (!ownerId || !destination) {
    // Structurally broken entry — DLQ, count as failed, ack.
    await sendToDlq(fieldArr, 'missing ownerId or destination_url');
    await tickProgress(importId, false);
    return true;
  }

  const power: PowerLinkConfig = {};
  if (f['slug']) power.customSlug = f['slug'];
  if (f['password_hash']) power.passwordHash = f['password_hash'];
  if (f['expires_at']) {
    const ts = Date.parse(f['expires_at']);
    if (!Number.isNaN(ts)) power.expiresAt = new Date(ts);
  }

  let result;
  try {
    result = await createLink({
      destination,
      ownerId,
      creatorIp: null,
      creatorUserAgent: null,
      ...(Object.keys(power).length > 0 ? { power } : {}),
    });
  } catch (err) {
    // Transient failure (DB/network/GSB outage) — leave pending to retry.
    console.error('[bulk-import] createLink threw', err);
    return false;
  }

  // A clean safety/slug rejection is a row-level failure, NOT a retry — count it
  // failed and ack so the import can complete.
  await tickProgress(importId, result.ok);
  return true;
}

async function processEntries(entries: StreamEntry[]): Promise<void> {
  for (const [id, fieldArr] of entries) {
    let handled: boolean;
    try {
      handled = await processRow(fieldArr);
    } catch (err) {
      console.error('[bulk-import] row error', err);
      handled = false;
    }

    if (handled) {
      await redis.xack(STREAM, GROUP, id);
      attempts.delete(id);
    } else {
      const n = (attempts.get(id) ?? 0) + 1;
      if (n >= MAX_ATTEMPTS) {
        await sendToDlq(fieldArr, `failed ${MAX_ATTEMPTS}x`);
        const f = fieldsToRecord(fieldArr);
        await tickProgress(f['importId'] ?? '', false);
        await redis.xack(STREAM, GROUP, id);
        attempts.delete(id);
      } else {
        attempts.set(id, n);
      }
    }

    // Throttle to ~50 rows/sec so the per-row Safe Browsing calls aren't swamped.
    await sleep(ROW_DELAY_MS);
  }
}

export async function runBulkImport(signal: AbortSignal): Promise<void> {
  await ensureGroup();
  console.log(`[bulk-import] consumer ${CONSUMER} on ${STREAM}`);

  while (!signal.aborted) {
    try {
      // 1. Reclaim our own pending entries (failed-create retries).
      const claimed = (await redis.xautoclaim(STREAM, GROUP, CONSUMER, 0, '0', 'COUNT', BATCH)) as [
        string,
        StreamEntry[],
        ...unknown[],
      ];
      const pending = claimed[1] ?? [];
      if (pending.length > 0) await processEntries(pending);

      // 2. Read new rows (blocks up to 5s when idle).
      const res = (await blocking.xreadgroup(
        'GROUP',
        GROUP,
        CONSUMER,
        'COUNT',
        BATCH,
        'BLOCK',
        5000,
        'STREAMS',
        STREAM,
        '>',
      )) as Array<[stream: string, entries: StreamEntry[]]> | null;

      const fresh = res?.[0]?.[1] ?? [];
      if (fresh.length > 0) await processEntries(fresh);
    } catch (err) {
      console.error('[bulk-import] loop error', err);
      captureException(err, { loop: 'bulk-import' });
      await sleep(1000);
    }
  }
}
