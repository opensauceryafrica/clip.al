import { env } from '@clipal/config';

/**
 * Polar.sh REST client (fetch-based, no SDK) for USD merchant-of-record billing.
 *
 * Polar is the USD processor in clip.al's dual-billing setup (NGN → Paystack,
 * else → Polar). It acts as merchant-of-record, so Polar — not us — handles tax
 * and remittance. We talk to it over its documented REST API at
 * https://api.polar.sh with a `Authorization: Bearer <POLAR_ACCESS_TOKEN>`
 * Organization Access Token.
 *
 * Like the GSB/Paystack integrations, Polar is OPTIONAL and self-gating: every
 * call short-circuits to a typed failure when `POLAR_ACCESS_TOKEN` is missing or
 * a placeholder, and NO call ever throws on a non-2xx — callers branch on
 * `result.ok` instead. That keeps a Polar outage from 500-ing a checkout flow.
 *
 * Docs:
 *  - Checkout:      POST   /v1/checkouts/            (Checkout Sessions API)
 *  - Subscription:  GET    /v1/subscriptions/{id}
 *  - Cancel:        PATCH  /v1/subscriptions/{id}    (cancel_at_period_end)
 *                   DELETE /v1/subscriptions/{id}    (immediate / revoke)
 */

const POLAR_API_BASE = 'https://api.polar.sh';

// Placeholder/dummy values used in .env.example, CI, and Docker build args. Real
// Polar tokens (prefixed `polar_oat_…`) never match these, so this only ever
// skips fake tokens.
const POLAR_PLACEHOLDER =
  /placeholder|changeme|change-me|example|dummy|your[-_]?(access[-_]?)?token|^x+$/i;

/** True only when a real-looking Polar access token is configured. */
export function isPolarConfigured(): boolean {
  const token = env.POLAR_ACCESS_TOKEN.trim();
  return token.length > 0 && !POLAR_PLACEHOLDER.test(token);
}

/**
 * Discriminated result for every Polar API call. We never throw on failure:
 * callers branch on `ok`. `status` is the HTTP status (0 for transport errors
 * or when Polar is unconfigured), `error` a short human-readable reason.
 */
export type PolarResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

function notConfigured<T>(): PolarResult<T> {
  return { ok: false, status: 0, error: 'polar_not_configured' };
}

/**
 * Low-level authenticated request. Never throws — transport errors and non-2xx
 * responses both come back as `{ ok: false }`. JSON bodies are parsed lazily and
 * defensively (a non-JSON error body never crashes the caller).
 */
async function polarFetch<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<PolarResult<T>> {
  if (!isPolarConfigured()) return notConfigured<T>();

  const url = `${POLAR_API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`,
        accept: 'application/json',
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'transport error';
    console.warn(`[polar] ${init.method} ${path} failed: ${msg}`);
    return { ok: false, status: 0, error: msg };
  }

  // 204 No Content (e.g. some DELETEs) — treat as empty success.
  if (res.status === 204) {
    return { ok: true, status: 204, data: undefined as T };
  }

  let parsed: unknown = undefined;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (!res.ok) {
    const detail = extractError(parsed) ?? res.statusText ?? 'request failed';
    console.warn(`[polar] ${init.method} ${path} -> ${res.status}: ${detail}`);
    return { ok: false, status: res.status, error: detail };
  }

  return { ok: true, status: res.status, data: parsed as T };
}

/** Pull a readable message out of Polar's error shapes without throwing. */
function extractError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { detail?: unknown; error?: unknown; message?: unknown };
  if (typeof b.detail === 'string') return b.detail;
  if (Array.isArray(b.detail) && b.detail.length > 0) {
    // FastAPI-style validation errors: [{ loc, msg, type }, ...]
    const first = b.detail[0] as { msg?: unknown };
    if (first && typeof first.msg === 'string') return first.msg;
  }
  if (typeof b.error === 'string') return b.error;
  if (typeof b.message === 'string') return b.message;
  return null;
}

// ----------------------------------------------------------------------------
// Typed surface
// ----------------------------------------------------------------------------

export interface CreateCheckoutParams {
  /** Polar price id the customer is subscribing to (one price of a product). */
  productPriceId: string;
  /** Pre-fill / bind the checkout to this email. */
  customerEmail: string;
  /** Absolute URL Polar redirects to after a successful payment. */
  successUrl: string;
  /** Opaque key/value pairs echoed back on webhooks (e.g. our userId/plan). */
  metadata?: Record<string, string>;
}

export interface CheckoutResult {
  /** Hosted Polar checkout URL to redirect the customer to. */
  checkoutUrl: string;
  /** Polar checkout session id (persist to reconcile the later webhook). */
  checkoutId: string;
}

interface PolarCheckoutResponse {
  id: string;
  url: string;
}

/**
 * Create a hosted Polar checkout session for a single subscription price.
 *
 * POST /v1/checkouts/  — body uses `product_price_id` + `products` (Polar's
 * current Checkout API keys the line off `products`; we also send the explicit
 * price for products with multiple prices). Returns the hosted `url` to redirect
 * to and the checkout `id`. Never throws.
 */
export async function createCheckout(
  params: CreateCheckoutParams,
): Promise<PolarResult<CheckoutResult>> {
  const body: Record<string, unknown> = {
    product_price_id: params.productPriceId,
    products: [params.productPriceId],
    customer_email: params.customerEmail,
    success_url: params.successUrl,
  };
  if (params.metadata && Object.keys(params.metadata).length > 0) {
    body.metadata = params.metadata;
  }

  const res = await polarFetch<PolarCheckoutResponse>('/v1/checkouts/', {
    method: 'POST',
    body,
  });
  if (!res.ok) return res;

  const { id, url } = res.data;
  if (!id || !url) {
    return { ok: false, status: res.status, error: 'malformed checkout response' };
  }
  return { ok: true, status: res.status, data: { checkoutId: id, checkoutUrl: url } };
}

export type PolarSubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid';

export interface PolarSubscription {
  id: string;
  status: PolarSubscriptionStatus;
  /** True once a cancel-at-period-end has been scheduled. */
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  customerId: string | null;
  productId: string | null;
  metadata: Record<string, unknown>;
  /** The raw provider payload, for callers that need fields we don't map. */
  raw: unknown;
}

interface PolarSubscriptionResponse {
  id: string;
  status: PolarSubscriptionStatus;
  cancel_at_period_end?: boolean;
  current_period_start?: string | null;
  current_period_end?: string | null;
  customer_id?: string | null;
  product_id?: string | null;
  metadata?: Record<string, unknown>;
}

function mapSubscription(r: PolarSubscriptionResponse): PolarSubscription {
  return {
    id: r.id,
    status: r.status,
    cancelAtPeriodEnd: r.cancel_at_period_end ?? false,
    currentPeriodStart: r.current_period_start ?? null,
    currentPeriodEnd: r.current_period_end ?? null,
    customerId: r.customer_id ?? null,
    productId: r.product_id ?? null,
    metadata: r.metadata ?? {},
    raw: r,
  };
}

/** GET /v1/subscriptions/{id}. Never throws. */
export async function getSubscription(id: string): Promise<PolarResult<PolarSubscription>> {
  const res = await polarFetch<PolarSubscriptionResponse>(
    `/v1/subscriptions/${encodeURIComponent(id)}`,
    { method: 'GET' },
  );
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: mapSubscription(res.data) };
}

/**
 * Cancel a subscription.
 *
 * - `atPeriodEnd = true`  → PATCH /v1/subscriptions/{id} with
 *   `cancel_at_period_end: true`; the subscription stays active until the end of
 *   the paid period (the typical "downgrade at renewal" UX).
 * - `atPeriodEnd = false` → DELETE /v1/subscriptions/{id}; revokes immediately.
 *
 * Never throws.
 */
export async function cancelSubscription(
  id: string,
  atPeriodEnd: boolean,
): Promise<PolarResult<PolarSubscription>> {
  const encoded = encodeURIComponent(id);
  const res = atPeriodEnd
    ? await polarFetch<PolarSubscriptionResponse>(`/v1/subscriptions/${encoded}`, {
        method: 'PATCH',
        body: { cancel_at_period_end: true },
      })
    : await polarFetch<PolarSubscriptionResponse>(`/v1/subscriptions/${encoded}`, {
        method: 'DELETE',
      });

  if (!res.ok) return res;
  // DELETE may return 204/empty; surface a minimal canceled view in that case.
  if (!res.data) {
    return {
      ok: true,
      status: res.status,
      data: {
        id,
        status: 'canceled',
        cancelAtPeriodEnd: atPeriodEnd,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        customerId: null,
        productId: null,
        metadata: {},
        raw: null,
      },
    };
  }
  return { ok: true, status: res.status, data: mapSubscription(res.data) };
}
