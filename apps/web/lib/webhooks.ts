import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { and, db, eq, sql, webhookDeliveries, webhooks } from '@clipal/db';

/**
 * Outbound webhook plumbing (spec §5/§9). This module owns two concerns:
 *
 *  - {@link emitWebhook}: fan an application event out to every active webhook of
 *    the owning user that is subscribed to the event, by enqueuing a
 *    `webhook_deliveries` row. The worker (`webhook-deliver` loop) does the
 *    actual HTTP POST + retries — emitting is a cheap insert on the request path.
 *  - {@link signPayload}: compute the `X-clipal-Signature` header value so both
 *    the delivery worker and any test-send path sign identically.
 *
 * The emit signature + the event-type union are deliberately exported so the
 * rest of the app (link actions, click-ingest, safety, expiry) can wire events
 * in without re-deriving the envelope shape.
 */

/** The closed set of event types clip.al can deliver (spec §5). */
export type WebhookEventType =
  | 'link.created'
  | 'link.updated'
  | 'link.deleted'
  | 'link.clicked'
  | 'link.threshold'
  | 'link.flagged_safety'
  | 'link.expired';

/** All event types, in display order — single source for the create/edit UI. */
export const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = [
  'link.created',
  'link.updated',
  'link.deleted',
  'link.clicked',
  'link.threshold',
  'link.flagged_safety',
  'link.expired',
] as const;

/** Human labels for the event checkboxes. */
export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  'link.created': 'Link created',
  'link.updated': 'Link updated',
  'link.deleted': 'Link deleted',
  'link.clicked': 'Link clicked',
  'link.threshold': 'Click threshold reached',
  'link.flagged_safety': 'Flagged by safety scan',
  'link.expired': 'Link expired',
} as const;

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/** The delivered envelope. `data` is event-specific and stored as-is. */
export interface WebhookEnvelope<T = Record<string, unknown>> {
  id: string;
  type: WebhookEventType;
  created: string;
  data: T;
}

/** A fresh signing secret for a webhook (shown once at creation). */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

/** A random event id for an envelope (`evt_<rand>`). */
function eventId(): string {
  return `evt_${randomBytes(16).toString('hex')}`;
}

/**
 * Compute the `X-clipal-Signature` header value for a raw request body.
 *
 * Format: `t=<unix_seconds>, v1=<hmac_sha256_hex>` where the HMAC is taken over
 * the string `"<ts>.<rawBody>"` (timestamp, a literal dot, then the raw body).
 * Receivers recompute this with their stored secret to verify authenticity and
 * guard against replay using the timestamp.
 */
export function signPayload(secret: string, rawBody: string, tsSec: number): string {
  const mac = createHmac('sha256', secret).update(`${tsSec}.${rawBody}`, 'utf8').digest('hex');
  return `t=${tsSec}, v1=${mac}`;
}

/**
 * Build the delivered envelope for an event. Exported so a test-send/replay path
 * can reconstruct the exact shape the worker will POST.
 */
export function buildEnvelope<T extends Record<string, unknown>>(
  type: WebhookEventType,
  data: T,
): WebhookEnvelope<T> {
  return { id: eventId(), type, created: new Date().toISOString(), data };
}

/**
 * Fan an event out to the user's active, subscribed webhooks by inserting a
 * pending `webhook_deliveries` row per endpoint (status pending = `delivered_at`
 * null, `next_retry_at` = now so the worker picks it up on its next pass).
 *
 * Best-effort and non-throwing: a webhook delivery must never break the action
 * that produced the event (creating a link, recording a click, etc.). Returns
 * the number of deliveries enqueued.
 */
export async function emitWebhook(
  userId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
): Promise<number> {
  try {
    // Active endpoints of this user whose `events` array contains the type. The
    // array containment is done in SQL so we never load endpoints we won't use.
    const targets = await db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(
        and(
          eq(webhooks.userId, userId),
          eq(webhooks.active, true),
          sql`${webhooks.events} @> ARRAY[${type}]::text[]`,
        ),
      );

    if (targets.length === 0) return 0;

    const now = new Date();
    const envelope = buildEnvelope(type, data);
    // One envelope per endpoint: same id/created/data, distinct delivery rows so
    // each endpoint retries independently.
    await db.insert(webhookDeliveries).values(
      targets.map((t) => ({
        webhookId: t.id,
        eventType: type,
        payload: envelope as unknown,
        nextRetryAt: now,
      })),
    );
    return targets.length;
  } catch (err) {
    // Swallow: emit is fire-and-forget relative to the triggering action.
    console.error('[webhooks] emit failed', { userId, type, err });
    return 0;
  }
}
