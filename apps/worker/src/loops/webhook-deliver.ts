import { createHmac } from 'node:crypto';
import { keys, redis } from '@clipal/cache';
import { getPublicBaseUrl } from '@clipal/config';
import {
  and,
  db,
  eq,
  isNull,
  lte,
  users,
  webhookDeliveries,
  webhooks,
} from '@clipal/db';
import { sendEmail } from '@clipal/email';
import { captureException } from '@clipal/observability';

/**
 * Outbound webhook delivery (spec §5/§9, AC6). Every ~10s this pass picks due,
 * undelivered `webhook_deliveries` rows and POSTs the signed payload to the
 * endpoint. On 2xx the row is marked delivered and the endpoint's success
 * timestamp bumped; on failure `attempts` increments and `next_retry_at` is set
 * by an exponential backoff. After 5 failed attempts the delivery is abandoned;
 * once an endpoint accrues enough consecutive failures it is auto-disabled and
 * its owner emailed.
 *
 * A single short Redis lock keeps one worker draining at a time so we never
 * double-POST the same row under multiple worker replicas.
 */

const BATCH = 50;
// Backoff schedule per failed attempt (ms): 1m, 5m, 30m, 2h, 12h.
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];
const MAX_ATTEMPTS = 5;
// Total request budget (connect + read). fetch has no separate connect timeout,
// so we cap the whole exchange at ~15s with an AbortController.
const REQUEST_TIMEOUT_MS = 15_000;
const RESPONSE_BODY_MAX = 4096;
const LOCK_TTL_MS = 30_000;

/** Recompute the X-clipal-Signature header (mirrors apps/web/lib/webhooks). */
function signPayload(secret: string, rawBody: string, tsSec: number): string {
  const mac = createHmac('sha256', secret).update(`${tsSec}.${rawBody}`, 'utf8').digest('hex');
  return `t=${tsSec}, v1=${mac}`;
}

interface DueRow {
  id: string;
  webhookId: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret: string;
  active: boolean;
  failureCount: number;
}

/** POST the signed body. Returns the HTTP status + a truncated response body. */
async function postDelivery(
  url: string,
  secret: string,
  rawBody: string,
): Promise<{ status: number; body: string }> {
  const tsSec = Math.floor(Date.now() / 1000);
  const signature = signPayload(secret, rawBody, tsSec);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'clip.al-webhooks/1',
        'x-clipal-signature': signature,
      },
      body: rawBody,
      redirect: 'manual', // never auto-follow; a 3xx counts as a non-2xx failure
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, body: text.slice(0, RESPONSE_BODY_MAX) };
  } finally {
    clearTimeout(timer);
  }
}

/** Mark a delivery succeeded + bump the endpoint's success/health fields. */
async function markSuccess(row: DueRow, status: number, body: string): Promise<void> {
  const now = new Date();
  await db
    .update(webhookDeliveries)
    .set({
      deliveredAt: now,
      attempts: row.attempts + 1,
      responseStatus: status,
      responseBody: body,
      nextRetryAt: null,
    })
    .where(eq(webhookDeliveries.id, row.id));

  await db
    .update(webhooks)
    .set({ lastDeliveryAt: now, lastSuccessAt: now, failureCount: 0 })
    .where(eq(webhooks.id, row.webhookId));
}

/**
 * Record a failed attempt. Schedules the next retry by backoff unless the
 * delivery has now failed MAX_ATTEMPTS times (then it's abandoned). Always bumps
 * the endpoint's failure health; once the endpoint reaches MAX_ATTEMPTS
 * consecutive failures it is disabled and the owner emailed.
 */
async function markFailure(
  row: DueRow,
  status: number | null,
  body: string,
): Promise<void> {
  const now = new Date();
  const attempts = row.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  // attempts is 1-based after increment; pick the backoff for this attempt index.
  const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 0;
  const nextRetryAt = exhausted ? null : new Date(now.getTime() + backoff);

  await db
    .update(webhookDeliveries)
    .set({
      attempts,
      responseStatus: status,
      responseBody: body,
      nextRetryAt,
    })
    .where(eq(webhookDeliveries.id, row.id));

  const endpointFailures = row.failureCount + 1;
  const shouldDisable = row.active && endpointFailures >= MAX_ATTEMPTS;

  await db
    .update(webhooks)
    .set({
      lastDeliveryAt: now,
      lastFailureAt: now,
      failureCount: endpointFailures,
      ...(shouldDisable ? { active: false } : {}),
    })
    .where(eq(webhooks.id, row.webhookId));

  if (shouldDisable) {
    await notifyOwnerDisabled(row.webhookId, row.url).catch((e: unknown) =>
      console.error('[webhook-deliver] owner notify failed', e),
    );
  }
}

/** Email the endpoint's owner that their webhook was auto-disabled. */
async function notifyOwnerDisabled(webhookId: string, url: string): Promise<void> {
  const [owner] = await db
    .select({ email: users.email })
    .from(webhooks)
    .innerJoin(users, eq(users.id, webhooks.userId))
    .where(eq(webhooks.id, webhookId))
    .limit(1);
  if (!owner?.email) return;

  let manageUrl = '/webhooks';
  try {
    manageUrl = new URL(`/webhooks/${webhookId}`, getPublicBaseUrl()).toString();
  } catch {
    // fall back to the relative path in the copy
  }

  await sendEmail({
    to: owner.email,
    subject: 'A clip.al webhook was disabled after repeated failures',
    html:
      `<p>Your webhook endpoint <strong>${escapeHtml(url)}</strong> failed to accept ` +
      `${MAX_ATTEMPTS} consecutive deliveries and has been automatically disabled.</p>` +
      `<p>Once you've fixed the endpoint, re-enable it from your webhook settings:</p>` +
      `<p><a href="${escapeHtml(manageUrl)}">${escapeHtml(manageUrl)}</a></p>`,
    text:
      `Your webhook endpoint ${url} failed ${MAX_ATTEMPTS} consecutive deliveries and was ` +
      `disabled. Re-enable it at ${manageUrl} once the endpoint is fixed.`,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One delivery pass. Guarded by a Redis lock so concurrent worker replicas don't
 * both pick the same due rows. Picks due+undelivered deliveries joined to their
 * (active) endpoint and attempts each once; retries are scheduled, not looped.
 */
export async function runWebhookDeliver(): Promise<void> {
  // Single-flight across replicas.
  const acquired = await redis.set(keys.webhookDeliverLock, '1', 'PX', LOCK_TTL_MS, 'NX');
  if (acquired !== 'OK') return;

  try {
    const now = new Date();
    const due = (await db
      .select({
        id: webhookDeliveries.id,
        webhookId: webhookDeliveries.webhookId,
        payload: webhookDeliveries.payload,
        attempts: webhookDeliveries.attempts,
        url: webhooks.url,
        secret: webhooks.secret,
        active: webhooks.active,
        failureCount: webhooks.failureCount,
      })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
      // Due + undelivered. Only deliver for active endpoints; a disabled endpoint
      // leaves its pending rows parked (re-enabling resets and they flow again).
      .where(
        and(
          isNull(webhookDeliveries.deliveredAt),
          lte(webhookDeliveries.nextRetryAt, now),
          eq(webhooks.active, true),
        ),
      )
      .orderBy(webhookDeliveries.nextRetryAt)
      .limit(BATCH)) as DueRow[];

    for (const row of due) {
      const rawBody = JSON.stringify(row.payload);
      try {
        const { status, body } = await postDelivery(row.url, row.secret, rawBody);
        if (status >= 200 && status < 300) {
          await markSuccess(row, status, body);
        } else {
          await markFailure(row, status, body);
        }
      } catch (err) {
        // Network error / timeout / abort — a delivery failure with no status.
        await markFailure(row, null, err instanceof Error ? err.message.slice(0, RESPONSE_BODY_MAX) : 'request failed');
      }
    }
  } catch (err) {
    console.error('[webhook-deliver] pass error', err);
    captureException(err, { loop: 'webhook-deliver' });
  } finally {
    // Best-effort release; the PX TTL is the real safety net.
    await redis.del(keys.webhookDeliverLock).catch(() => undefined);
  }
}
