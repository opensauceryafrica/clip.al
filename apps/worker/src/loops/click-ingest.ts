import { createRedis, keys, redis } from '@clipal/cache';
import { insertClicks, toChDateTime, type ClickRow } from '@clipal/ch';
import { db, eq, links, sql } from '@clipal/db';
import { geoLookup } from '../lib/geo';
import { getDailySalt, hashIp, utcDateKey } from '../lib/salt';
import { parseUa } from '../lib/ua';
import { workerState } from '../health';

/**
 * Click ingest (§10). Drains the Redis `clicks` stream with a consumer group,
 * enriches each event (UA parse, bot tag, geo, salted IP hash, referrer→host),
 * and batch-inserts to ClickHouse. Only XACKs after a successful insert; a
 * message that fails 3× is routed to the dead-letter stream. After each
 * successful batch it updates the denormalized links.clicks_total per code.
 */
const STREAM = keys.clickStream;
const GROUP = 'clicks-cg';
const CONSUMER = `worker-${process.pid}`;
const BATCH = 500;
const MAX_ATTEMPTS = 3;

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

function referrerHost(referrer: string): string {
  if (!referrer) return '';
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return '';
  }
}

async function ensureGroup(): Promise<void> {
  try {
    // '0' so events enqueued before the worker started are not lost.
    await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
  }
}

async function sendToDlq(fields: string[], reason: string): Promise<void> {
  await redis.xadd(keys.clickDlq, 'MAXLEN', '~', 100_000, '*', ...fields, '_error', reason);
}

async function updateCounters(perCode: Map<string, { delta: number; maxTs: Date }>): Promise<void> {
  // One UPDATE per code per batch — cheap even at high throughput (§10).
  for (const [code, { delta, maxTs }] of perCode) {
    await db
      .update(links)
      .set({
        clicksTotal: sql`${links.clicksTotal} + ${delta}`,
        lastClickAt: sql`greatest(${links.lastClickAt}, ${maxTs})`,
      })
      .where(eq(links.code, code))
      .catch((e: unknown) => console.error('[click-ingest] counter update failed', e));
  }
}

async function processEntries(entries: StreamEntry[]): Promise<void> {
  const rows: ClickRow[] = [];
  const ids: string[] = [];
  const saltCache = new Map<string, string>();
  const perCode = new Map<string, { delta: number; maxTs: Date }>();

  for (const [id, fieldArr] of entries) {
    try {
      const f = fieldsToRecord(fieldArr);
      const tsDate = new Date(f['ts'] ?? '');
      if (Number.isNaN(tsDate.getTime())) throw new Error('invalid ts');

      const dateKey = utcDateKey(tsDate);
      let salt = saltCache.get(dateKey);
      if (!salt) {
        salt = await getDailySalt(tsDate);
        saltCache.set(dateKey, salt);
      }

      const ip = f['ip'] ?? '0.0.0.0';
      const geo = geoLookup(ip);
      const ua = parseUa(f['ua'] ?? '');
      const code = f['code'] ?? '';

      rows.push({
        ts: toChDateTime(tsDate),
        link_code: code,
        link_id: f['link_id'] ?? '',
        owner_id: f['owner_id'] ? f['owner_id'] : null,
        ip_hash: hashIp(ip, salt),
        country: geo.country,
        region: geo.region,
        city: geo.city,
        ua_family: ua.family,
        ua_os: ua.os,
        device: ua.device,
        referrer_host: referrerHost(f['referrer'] ?? ''),
        is_bot: ua.isBot ? 1 : 0,
        is_interstitial: f['is_interstitial'] === '1' ? 1 : 0,
        utm_source: f['utm_source'] ?? '',
        utm_medium: f['utm_medium'] ?? '',
        utm_campaign: f['utm_campaign'] ?? '',
      });
      ids.push(id);

      // Only non-bot clicks count toward the billable denormalized counter.
      if (!ua.isBot && code) {
        const cur = perCode.get(code) ?? { delta: 0, maxTs: tsDate };
        cur.delta += 1;
        if (tsDate > cur.maxTs) cur.maxTs = tsDate;
        perCode.set(code, cur);
      }
    } catch (err) {
      // Malformed message: DLQ + ack so it can't block the stream head.
      await sendToDlq(fieldArr, `parse error: ${String(err)}`);
      await redis.xack(STREAM, GROUP, id);
      attempts.delete(id);
    }
  }

  if (rows.length === 0) return;

  try {
    await insertClicks(rows);
  } catch (err) {
    // ClickHouse insert failed: retry (leave pending) up to MAX_ATTEMPTS, then DLQ.
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const n = (attempts.get(id) ?? 0) + 1;
      if (n >= MAX_ATTEMPTS) {
        await sendToDlq(entries[i]?.[1] ?? [], 'clickhouse insert failed 3x');
        await redis.xack(STREAM, GROUP, id);
        attempts.delete(id);
      } else {
        attempts.set(id, n);
      }
    }
    console.error('[click-ingest] ClickHouse insert failed; pending will retry', err);
    await sleep(2000); // back off so a ClickHouse blip doesn't spin the loop
    return;
  }

  await redis.xack(STREAM, GROUP, ...ids);
  for (const id of ids) attempts.delete(id);
  await updateCounters(perCode);

  workerState.processedClicks += rows.length;
  workerState.lastClickBatchAt = Date.now();
}

export async function runClickIngest(signal: AbortSignal): Promise<void> {
  await ensureGroup();
  console.log(`[click-ingest] consumer ${CONSUMER} on ${STREAM}`);

  while (!signal.aborted) {
    try {
      // 1. Reclaim our own pending entries (failed-insert retries).
      const claimed = (await redis.xautoclaim(STREAM, GROUP, CONSUMER, 0, '0', 'COUNT', BATCH)) as [
        string,
        StreamEntry[],
        ...unknown[],
      ];
      const pending = claimed[1] ?? [];
      if (pending.length > 0) await processEntries(pending);

      // 2. Read new messages (blocks up to 5s when idle).
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
      console.error('[click-ingest] loop error', err);
      await sleep(1000);
    }
  }
}
