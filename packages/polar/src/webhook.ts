import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@clipal/config';

/**
 * Polar webhook signature verification.
 *
 * Polar signs webhooks with the **Standard Webhooks** scheme
 * (https://www.standardwebhooks.com), the same scheme as Svix. Three headers
 * travel with each delivery:
 *
 *   webhook-id         opaque message id
 *   webhook-timestamp  unix seconds the message was sent
 *   webhook-signature  space-delimited list of `v<version>,<base64sig>` tokens
 *
 * The signed payload is the literal string `${id}.${timestamp}.${rawBody}`,
 * HMAC-SHA256'd with the webhook secret, base64-encoded. The secret is the
 * `POLAR_WEBHOOK_SECRET`; per the spec it MAY carry a `whsec_` prefix and the
 * remainder is base64-decoded to the raw HMAC key.
 *
 * IMPORTANT: pass the RAW request body bytes/string exactly as received
 * (`await request.text()`), NOT a re-serialized JSON object — any whitespace or
 * key-order change breaks the HMAC.
 *
 * This is the security boundary for the cross-origin webhook route, so:
 *  - comparison is timing-safe,
 *  - a stale/future timestamp (outside tolerance) is rejected (replay defense),
 *  - it returns a plain boolean and NEVER throws (a malformed header is just
 *    `false`, never a 500).
 */

/** Reject deliveries whose timestamp drifts more than this from now (seconds). */
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

const PLACEHOLDER =
  /placeholder|changeme|change-me|example|dummy|your[-_]?(webhook[-_]?)?secret|^x+$/i;

/** True only when a real-looking Polar webhook secret is configured. */
export function isPolarWebhookConfigured(): boolean {
  const secret = env.POLAR_WEBHOOK_SECRET.trim();
  return secret.length > 0 && !PLACEHOLDER.test(secret);
}

/** Case-insensitive header read from a Headers instance or a plain record. */
function readHeader(headers: HeadersLike, name: string): string | null {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower) {
      const v = record[key];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    }
  }
  return null;
}

export type HeadersLike = Headers | Record<string, string | string[] | undefined>;

/**
 * Derive the raw HMAC key bytes from the configured secret. Standard Webhooks
 * secrets are `whsec_<base64>`; tolerate a missing prefix and fall back to
 * treating the value as raw UTF-8 if it is not valid base64.
 */
function secretKey(): Buffer {
  const raw = env.POLAR_WEBHOOK_SECRET.trim();
  const b64 = raw.startsWith('whsec_') ? raw.slice('whsec_'.length) : raw;
  // base64 round-trips cleanly only for valid base64; if not, use UTF-8 bytes.
  try {
    const decoded = Buffer.from(b64, 'base64');
    if (decoded.length > 0 && decoded.toString('base64').replace(/=+$/, '') === b64.replace(/=+$/, '')) {
      return decoded;
    }
  } catch {
    /* fall through */
  }
  return Buffer.from(raw, 'utf8');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a Polar (Standard Webhooks) signature over the raw body.
 *
 * Returns `true` only when the signature is configured, the timestamp is within
 * tolerance, and at least one provided `v1` signature matches our computed HMAC.
 * Returns `false` for every failure mode — missing config, missing headers,
 * stale timestamp, no match — and never throws.
 */
export function verifyWebhookSignature(
  rawBody: string,
  headers: HeadersLike,
  opts?: { toleranceSeconds?: number; now?: number },
): boolean {
  if (!isPolarWebhookConfigured()) return false;

  const id = readHeader(headers, 'webhook-id');
  const timestamp = readHeader(headers, 'webhook-timestamp');
  const signatureHeader = readHeader(headers, 'webhook-signature');
  if (!id || !timestamp || !signatureHeader) return false;

  // Replay defense: timestamp must be a sane unix-seconds value within tolerance.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  const tolerance = opts?.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - ts) > tolerance) return false;

  // Compute the expected v1 signature over `${id}.${timestamp}.${body}`.
  let expected: string;
  try {
    expected = createHmac('sha256', secretKey())
      .update(`${id}.${timestamp}.${rawBody}`, 'utf8')
      .digest('base64');
  } catch {
    return false;
  }

  // The header is a space-delimited list of `version,signature` tokens. Compare
  // against every `v1` entry, timing-safely, and short-circuit on the first hit.
  let matched = false;
  for (const token of signatureHeader.split(' ')) {
    const comma = token.indexOf(',');
    if (comma === -1) continue;
    const version = token.slice(0, comma);
    const sig = token.slice(comma + 1);
    if (version !== 'v1' || !sig) continue;
    // Always run the comparison (don't break early) to keep timing uniform.
    if (timingSafeEqualStr(sig, expected)) matched = true;
  }
  return matched;
}
