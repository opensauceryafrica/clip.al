import { randomBytes } from 'node:crypto';
import { keys, redis } from '@clipal/cache';
import {
  and,
  db,
  eq,
  gte,
  isNotNull,
  links,
  sql,
  webhookDeliveries,
  webhooks,
} from '@clipal/db';
import { captureException } from '@clipal/observability';

/**
 * Click-threshold detector (spec §5/§9). Every ~60s, scan links whose
 * denormalized `clicks_total` has crossed one of the milestone thresholds and
 * emit a `link.threshold` webhook to the link's owner — exactly once per
 * (link, threshold).
 *
 * "Exactly once" is tracked in a Redis hash (`webhook:threshold:seen`, field =
 * link id, value = the highest threshold already emitted). We never touch the
 * links schema for this; the hash is the cursor. A link that has already crossed
 * 10k when first seen (e.g. imported with a high count) emits only the highest
 * crossed threshold once, not every lower one.
 */

const THRESHOLDS = [100, 1_000, 10_000, 100_000];
const SMALLEST = THRESHOLDS[0]!;
const BATCH = 500;
const LOCK_TTL_MS = 55_000;

/** Mirror of apps/web/lib/webhooks signPayload's envelope id scheme. */
function eventId(): string {
  return `evt_${randomBytes(16).toString('hex')}`;
}

/** Highest threshold that `total` has crossed, or null if below the smallest. */
function crossedThreshold(total: number): number | null {
  let hit: number | null = null;
  for (const t of THRESHOLDS) {
    if (total >= t) hit = t;
  }
  return hit;
}

/**
 * Enqueue a `link.threshold` delivery for every active, subscribed webhook of
 * the owner. This is the worker-side mirror of apps/web/lib/webhooks#emitWebhook
 * (that module is `server-only`, so the worker re-implements the same insert).
 * Returns the number of deliveries enqueued.
 */
async function emitThreshold(
  ownerId: string,
  data: Record<string, unknown>,
): Promise<number> {
  const targets = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.userId, ownerId),
        eq(webhooks.active, true),
        sql`${webhooks.events} @> ARRAY['link.threshold']::text[]`,
      ),
    );
  if (targets.length === 0) return 0;

  const envelope = {
    id: eventId(),
    type: 'link.threshold' as const,
    created: new Date().toISOString(),
    data,
  };
  const now = new Date();
  await db.insert(webhookDeliveries).values(
    targets.map((t) => ({
      webhookId: t.id,
      eventType: 'link.threshold',
      payload: envelope as unknown,
      nextRetryAt: now,
    })),
  );
  return targets.length;
}

export async function runThresholdDetector(): Promise<void> {
  // Single-flight across replicas — the seen-hash is read-modify-written below.
  const acquired = await redis.set(keys.webhookThresholdLock, '1', 'PX', LOCK_TTL_MS, 'NX');
  if (acquired !== 'OK') return;

  try {
    // Candidate set: links with an owner that have crossed at least the smallest
    // threshold. We further filter against the seen-hash in app code so we only
    // emit on a *new* threshold crossing.
    const candidates = await db
      .select({
        id: links.id,
        code: links.code,
        ownerId: links.ownerId,
        clicksTotal: links.clicksTotal,
      })
      .from(links)
      .where(and(isNotNull(links.ownerId), gte(links.clicksTotal, SMALLEST)))
      .orderBy(links.id)
      .limit(BATCH);

    if (candidates.length === 0) return;

    // Bulk-read the last-emitted threshold for this batch.
    const ids = candidates.map((c) => c.id);
    const seenRaw = await redis.hmget(keys.webhookThresholdSeen, ...ids);
    const seen = new Map<string, number>();
    candidates.forEach((c, i) => {
      const v = seenRaw[i];
      if (v != null) seen.set(c.id, Number(v));
    });

    for (const link of candidates) {
      const ownerId = link.ownerId;
      if (!ownerId) continue;

      const crossed = crossedThreshold(link.clicksTotal);
      if (crossed === null) continue;

      const last = seen.get(link.id) ?? 0;
      if (crossed <= last) continue; // already emitted this (or a higher) milestone

      try {
        await emitThreshold(ownerId, {
          link: { id: link.id, code: link.code },
          threshold: crossed,
          clicksTotal: link.clicksTotal,
        });
        // Advance the cursor regardless of whether any endpoint was subscribed —
        // the milestone is "reached" either way and shouldn't re-fire later.
        await redis.hset(keys.webhookThresholdSeen, link.id, String(crossed));
      } catch (err) {
        console.error('[threshold-detector] emit failed', { linkId: link.id, err });
        captureException(err, { loop: 'threshold-detector', linkId: link.id });
        // Leave the cursor untouched so the next pass retries this link.
      }
    }
  } catch (err) {
    console.error('[threshold-detector] pass error', err);
    captureException(err, { loop: 'threshold-detector' });
  } finally {
    await redis.del(keys.webhookThresholdLock).catch(() => undefined);
  }
}
