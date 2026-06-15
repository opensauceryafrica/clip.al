import { env } from '@clipal/config';

/**
 * Paystack base URL. All API calls are authenticated with a
 * `Authorization: Bearer <PAYSTACK_SECRET_KEY>` header.
 * @see https://paystack.com/docs/api/
 */
export const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// Common placeholder/dummy values used in .env.example, CI, and Docker build
// args. Real Paystack secret keys are `sk_test_…` / `sk_live_…`; this regex
// only ever skips obviously-fake values, never a real key.
const PAYSTACK_PLACEHOLDER =
  /placeholder|changeme|change-me|example|dummy|your[-_]?(secret[-_]?)?key|^x+$/i;

/**
 * True only when a real-looking Paystack secret key is configured
 * (non-empty, non-placeholder). Features self-gate on this — same
 * optional-by-default pattern as GSB (`isGsbConfigured`). When false, no
 * Paystack network call is ever attempted.
 */
export function isPaystackConfigured(): boolean {
  const key = env.PAYSTACK_SECRET_KEY.trim();
  return key.length > 0 && !PAYSTACK_PLACEHOLDER.test(key);
}
