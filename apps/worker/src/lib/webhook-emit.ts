import { randomBytes } from 'node:crypto';
import { and, db, eq, inArray, sql, webhookDeliveries, webhooks } from '@clipal/db';

/**
 * Worker-side mirror of apps/web/lib/webhooks#emitWebhook (that module is
 * `server-only`, so the worker re-implements the same `webhook_deliveries`
 * insert + envelope shape). The `webhook-deliver` loop does the actual HTTP POST.
 */
function eventId(): string {
  return `evt_${randomBytes(16).toString('hex')}`;
}

export interface ClickedEvent {
  ownerId: string;
  data: Record<string, unknown>;
}

/**
 * Enqueue `link.clicked` deliveries for a batch of non-bot clicks. Does ONE query
 * to find which owners have an active webhook subscribed to `link.clicked`, then a
 * single bulk insert — so the per-click cost on the ingest loop stays flat (§5/AC6:
 * a webhook fires within ~10s of a click). Never throws.
 */
export async function enqueueClickedWebhooks(events: ClickedEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  try {
    const owners = [...new Set(events.map((e) => e.ownerId))];
    const subs = await db
      .select({ id: webhooks.id, userId: webhooks.userId })
      .from(webhooks)
      .where(
        and(
          inArray(webhooks.userId, owners),
          eq(webhooks.active, true),
          sql`${webhooks.events} @> ARRAY['link.clicked']::text[]`,
        ),
      );
    if (subs.length === 0) return 0;

    const byOwner = new Map<string, string[]>();
    for (const s of subs) {
      const arr = byOwner.get(s.userId) ?? [];
      arr.push(s.id);
      byOwner.set(s.userId, arr);
    }

    const now = new Date();
    const rows = [];
    for (const ev of events) {
      const ids = byOwner.get(ev.ownerId);
      if (!ids) continue;
      const envelope = {
        id: eventId(),
        type: 'link.clicked' as const,
        created: now.toISOString(),
        data: ev.data,
      };
      for (const webhookId of ids) {
        rows.push({
          webhookId,
          eventType: 'link.clicked',
          payload: envelope as unknown,
          nextRetryAt: now,
        });
      }
    }
    if (rows.length === 0) return 0;
    await db.insert(webhookDeliveries).values(rows);
    return rows.length;
  } catch (err) {
    console.error('[webhook-emit] enqueue link.clicked failed', err);
    return 0;
  }
}
