import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@clipal/config';
import { isPaystackConfigured } from './config';

/**
 * Verify a Paystack webhook signature.
 *
 * Paystack signs the RAW request body with HMAC-SHA512 keyed on your secret key,
 * and sends the lowercase-hex digest in the `x-paystack-signature` header. The
 * comparison MUST be over the raw, unparsed body bytes (re-serializing parsed
 * JSON will not match) and MUST be timing-safe.
 *
 * Returns `false` (never throws) on any failure: unconfigured key, missing /
 * malformed header, or digest mismatch.
 *
 * @see https://paystack.com/docs/payments/webhooks/#verify-event-origin
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
): boolean {
  if (!isPaystackConfigured()) return false;
  if (!signatureHeader) return false;

  const expected = createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(rawBody, 'utf8').digest('hex');

  // Both sides are fixed-length lowercase hex (128 chars for SHA-512). Guard the
  // length before timingSafeEqual, which throws on unequal-length buffers.
  const provided = signatureHeader.trim().toLowerCase();
  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Paystack webhook envelope. The `event` string (e.g. `charge.success`,
 * `subscription.create`, `subscription.disable`, `invoice.payment_failed`)
 * drives processing; `data` shape varies by event.
 *
 * NOTE: Paystack does not provide a per-event id in the body. Callers building
 * the idempotency key for `billingEvents` should derive one — e.g.
 * `${event}:${data.reference ?? data.subscription_code ?? data.id}` — to satisfy
 * the `UNIQUE(processor, eventId)` constraint.
 */
export interface PaystackWebhookEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Parse a verified raw webhook body into a typed envelope, or `null` if it is
 * not the expected `{ event, data }` shape. Does NOT verify the signature — call
 * `verifyWebhookSignature` first.
 */
export function parseWebhookEvent(rawBody: string): PaystackWebhookEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { event?: unknown }).event !== 'string'
  ) {
    return null;
  }
  const obj = parsed as { event: string; data?: unknown };
  return {
    event: obj.event,
    data:
      typeof obj.data === 'object' && obj.data !== null
        ? (obj.data as Record<string, unknown>)
        : {},
  };
}
