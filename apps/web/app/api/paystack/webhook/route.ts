/**
 * POST /api/paystack/webhook — inbound Paystack billing webhook (§7).
 *
 * This route is CROSS-ORIGIN: Paystack's servers call it, so it is NOT
 * same-origin gated. Security is the HMAC-SHA512 signature over the RAW body
 * (verifyWebhookSignature). Flow:
 *
 *   1. Read the raw body (request.text()) — re-serializing JSON breaks the HMAC.
 *   2. Verify the `x-paystack-signature` header → 401 on failure.
 *   3. Insert a billing_events row FIRST (UNIQUE(processor,event_id) makes a
 *      redelivery a no-op) and skip processing when it's a duplicate.
 *   4. Normalize → applyBillingEvent inline, then stamp processed_at.
 *   5. Return 200 fast. Inline-processing failures are swallowed (still 200) —
 *      the worker's billing-processor loop drains any unprocessed row as a safety
 *      net, and returning non-200 would only trigger pointless Paystack retries
 *      against an event we've already durably recorded.
 */
import { captureException } from '@clipal/observability';
import { billingEvents, db, eq, sql, users } from '@clipal/db';
import {
  applyBillingEvent,
  normalizePaystackEvent,
  parseWebhookEvent,
  paystackEventId,
} from '@clipal/billing';
import { verifyWebhookSignature } from '@clipal/paystack';
import { sendSubscriptionReceipt } from '@clipal/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    return new Response('invalid signature', { status: 401 });
  }

  const parsed = parseWebhookEvent(rawBody);
  if (!parsed) {
    // Signature was valid but the body isn't the expected shape — ack so we
    // aren't retried, but record nothing.
    return new Response('ok', { status: 200 });
  }

  const eventId = paystackEventId(parsed);

  // Durable, idempotent record FIRST. A redelivery (same processor+event_id)
  // conflicts and returns no row → we short-circuit without re-processing.
  const inserted = await db
    .insert(billingEvents)
    .values({
      processor: 'paystack',
      eventId,
      eventType: parsed.event,
      payload: parsed,
    })
    .onConflictDoNothing({ target: [billingEvents.processor, billingEvents.eventId] })
    .returning({ id: billingEvents.id });

  if (inserted.length === 0) {
    return new Response('ok', { status: 200 }); // duplicate delivery
  }
  const rowId = inserted[0]!.id;

  // Process inline (best-effort). Failures fall through to the worker drain.
  try {
    const normalized = normalizePaystackEvent(parsed);
    if (normalized) {
      const result = await applyBillingEvent(normalized);
      if (result.paidInvoice) {
        await sendReceipt(normalized.data.userId, result.paidInvoice).catch(() => {});
      }
    }
    await db
      .update(billingEvents)
      .set({ processedAt: sql`now()` })
      .where(eq(billingEvents.id, rowId));
  } catch (err) {
    captureException(err, { route: 'paystack.webhook', eventId });
    // Leave processedAt NULL — the worker picks it up.
  }

  return new Response('ok', { status: 200 });
}

async function sendReceipt(
  userId: string,
  invoice: { amountMinor: number; currency: string; periodEnd: Date | null },
): Promise<void> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return;
  await sendSubscriptionReceipt(row.email, {
    plan: 'subscription',
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    periodEnd: invoice.periodEnd,
  });
}
