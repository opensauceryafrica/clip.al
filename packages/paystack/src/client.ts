import { env } from '@clipal/config';
import { PAYSTACK_BASE_URL, isPaystackConfigured } from './config';

/**
 * A typed result for every Paystack call. We NEVER throw on a non-2xx response
 * (or a network error / unconfigured key) — callers branch on `ok`. This mirrors
 * the non-blocking GSB pattern: a Paystack outage must not 500 a billing action.
 */
export type PaystackResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

/** Shape Paystack wraps every JSON response in. */
interface PaystackEnvelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  /** JSON body (POST). Omitted for GET. */
  body?: unknown;
  /** Query params appended to the path (GET). */
  query?: Record<string, string | number | undefined>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, `${PAYSTACK_BASE_URL}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Low-level authenticated request to the Paystack REST API. Unwraps Paystack's
 * `{ status, message, data }` envelope: a `2xx` with `status: true` resolves to
 * `{ ok: true, data }`; anything else (non-2xx, `status: false`, malformed JSON,
 * unconfigured key, thrown fetch) resolves to `{ ok: false, error }`. Never throws.
 */
export async function paystackRequest<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<PaystackResult<T>> {
  if (!isPaystackConfigured()) {
    return { ok: false, status: 0, error: 'paystack_not_configured' };
  }

  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    accept: 'application/json',
  };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'network_error';
    console.warn(`[paystack] request to ${path} failed: ${error}`);
    return { ok: false, status: 0, error };
  }

  let envelope: PaystackEnvelope<T>;
  try {
    envelope = (await res.json()) as PaystackEnvelope<T>;
  } catch {
    return {
      ok: false,
      status: res.status,
      error: res.ok ? 'invalid_json' : `http_${res.status}`,
    };
  }

  if (!res.ok || envelope.status === false || envelope.data === undefined) {
    return {
      ok: false,
      status: res.status,
      error: envelope.message ?? `http_${res.status}`,
    };
  }

  return { ok: true, status: res.status, data: envelope.data };
}
