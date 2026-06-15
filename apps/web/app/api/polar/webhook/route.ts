/**
 * POST /api/polar/webhook — inbound Polar.sh billing webhook (§7).
 *
 * CROSS-ORIGIN (Polar's servers call it) → NOT same-origin gated. Security is the
 * Standard Webhooks signature (`webhook-id` / `webhook-timestamp` /
 * `webhook-signature`) over the RAW body, verified by `verifyWebhookSignature`.
 *
 * Mirrors the Paystack route: verify → record billing_events first (idempotent on
 * the `webhook-id` delivery id) → normalize → applyBillingEvent inline → stamp
 * processed_at → 200 fast. The worker drains anything left unprocessed.
 */
import { captureException } from '@clipal/observability';
import { billingEvents, db, eq, sql, users } from '@clipal/db';
import { applyBillingEvent, normalizePolarEvent } from '@clipal/billing';
import { verifyWebhookSignature } from '@clipal/polar';
import { sendSubscriptionReceipt } from '@clipal/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PolarEnvelope {
  type: string;
  data: Record<string, unknown>;
}

function parseEnvelope(raw: string): PolarEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { type?: unknown }).type !== 'string'
  ) {
    return null;
  }
  const obj = parsed as { type: string; data?: unknown };
  return {
    type: obj.type,
    data:
      typeof obj.data === 'object' && obj.data !== null
        ? (obj.data as Record<string, unknown>)
        : {},
  };
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  if (!verifyWebhookSignature(rawBody, request.headers)) {
    return new Response('invalid signature', { status: 401 });
  }

  const envelope = parseEnvelope(rawBody);
  if (!envelope) return new Response('ok', { status: 200 });

  // Standard Webhooks gives us a stable per-delivery id; use it for idempotency.
  const eventId = request.headers.get('webhook-id') ?? `${envelope.type}:${Date.now()}`;

  const inserted = await db
    .insert(billingEvents)
    .values({
      processor: 'polar',
      eventId,
      eventType: envelope.type,
      payload: envelope,
    })
    .onConflictDoNothing({ target: [billingEvents.processor, billingEvents.eventId] })
    .returning({ id: billingEvents.id });

  if (inserted.length === 0) return new Response('ok', { status: 200 });
  const rowId = inserted[0]!.id;

  try {
    const normalized = normalizePolarEvent(envelope);
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
    captureException(err, { route: 'polar.webhook', eventId });
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
