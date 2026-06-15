import { and, billingEvents, db, eq, isNull, sql, users } from '@clipal/db';
import {
  applyBillingEvent,
  normalizePaystackEvent,
  normalizePolarEvent,
  type NormalizedEvent,
} from '@clipal/billing';
import { sendSubscriptionReceipt } from '@clipal/email';

const BATCH = 100;

/**
 * Billing event drain (§7 safety net). Every ~15s, pick up billing_events rows
 * that were recorded but never finished processing (`processed_at IS NULL`) —
 * e.g. the inline webhook process crashed, the web container restarted
 * mid-flight, or applyBillingEvent threw transiently — re-normalize the stored
 * payload, apply it, and stamp `processed_at`.
 *
 * applyBillingEvent is idempotent (subscription upserts are convergent; invoices
 * are UNIQUE on provider_reference), so re-running an event the webhook already
 * handled is harmless. This loop is purely a completeness guarantee: every
 * durably-recorded event eventually reaches the subscription state.
 */
export async function runBillingProcessor(): Promise<void> {
  const pending = await db
    .select({
      id: billingEvents.id,
      processor: billingEvents.processor,
      eventType: billingEvents.eventType,
      payload: billingEvents.payload,
    })
    .from(billingEvents)
    .where(isNull(billingEvents.processedAt))
    .orderBy(billingEvents.createdAt)
    .limit(BATCH);

  if (pending.length === 0) return;

  for (const row of pending) {
    try {
      const normalized = normalize(row.processor, row.payload);
      if (normalized) {
        const result = await applyBillingEvent(normalized);
        if (result.paidInvoice) {
          await notifyReceipt(normalized.data.userId, result.paidInvoice).catch((e: unknown) =>
            console.error('[billing-processor] receipt failed', e),
          );
        }
      }
      // Mark processed even when there was nothing to do (an ignored event type)
      // so we don't re-scan it every tick.
      await db
        .update(billingEvents)
        .set({ processedAt: sql`now()` })
        .where(and(eq(billingEvents.id, row.id), isNull(billingEvents.processedAt)));
    } catch (err) {
      // Leave processed_at NULL → retried next tick. Log but keep draining.
      console.error(`[billing-processor] event ${row.id} failed`, err);
    }
  }

  console.log(`[billing-processor] drained ${pending.length} event(s)`);
}

/** Re-derive a NormalizedEvent from a stored webhook payload, per processor. */
function normalize(processor: 'paystack' | 'polar', payload: unknown): NormalizedEvent | null {
  if (payload === null || typeof payload !== 'object') return null;
  if (processor === 'paystack') {
    const p = payload as { event?: unknown; data?: unknown };
    if (typeof p.event !== 'string') return null;
    return normalizePaystackEvent({
      event: p.event,
      data: (p.data ?? {}) as Record<string, unknown>,
    });
  }
  const p = payload as { type?: unknown; data?: unknown };
  if (typeof p.type !== 'string') return null;
  return normalizePolarEvent({
    type: p.type,
    data: (p.data ?? {}) as Record<string, unknown>,
  });
}

async function notifyReceipt(
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
