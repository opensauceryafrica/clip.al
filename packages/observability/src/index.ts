import { env } from '@clipal/config';
import * as Sentry from '@sentry/node';

/**
 * Error tracking for self-hosted GlitchTip (Sentry SDK-compatible). Server-side
 * only (web route handlers/actions via Next's onRequestError, and the worker).
 *
 * Hard rules:
 *  - No-op unless SENTRY_DSN is set.
 *  - PII never leaves the process: a beforeSend scrubber redacts emails, auth
 *    codes, session tokens (JWTs) and IPs from every event, and drops cookies /
 *    headers / request bodies. `sendDefaultPii: false` keeps Sentry from
 *    auto-attaching IPs/cookies in the first place.
 */

let enabled = false;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const SIX_DIGIT_RE = /\b\d{6}\b/g; // auth codes (and the odd 6-digit number — fine to over-redact)

/** Redact PII patterns from a string. */
export function redactPii(input: string): string {
  return input
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(JWT_RE, '[redacted-token]')
    .replace(IPV4_RE, '[redacted-ip]')
    .replace(SIX_DIGIT_RE, '[redacted-code]');
}

function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[redacted-depth]';
  if (typeof value === 'string') return redactPii(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** beforeSend: strip identity + redact PII from anything that could carry it. */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.user; // never attach a user identity

  if (event.request) {
    delete event.request.cookies; // session JWT
    delete event.request.headers; // cookie / authorization / forwarded IP
    delete event.request.data; // form bodies (email, 6-digit code)
    if (typeof event.request.url === 'string') event.request.url = redactPii(event.request.url);
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = redactPii(event.request.query_string);
    }
  }

  if (event.message) event.message = redactPii(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = redactPii(ex.value);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.message === 'string') crumb.message = redactPii(crumb.message);
    if (crumb.data) crumb.data = redactDeep(crumb.data) as Record<string, unknown>;
  }
  if (event.extra) event.extra = redactDeep(event.extra) as Record<string, unknown>;

  return event;
}

/**
 * Initialize Sentry for a service. No-op (returns false) without a DSN. Logs a
 * single [boot] line either way so it's obvious whether tracking is on.
 */
export function initSentry(service: 'web' | 'worker'): boolean {
  if (enabled) return true;
  if (!env.SENTRY_DSN) {
    console.warn(`[boot] Sentry/GlitchTip disabled — SENTRY_DSN not set (${service})`);
    return false;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0, // errors only — no performance tracing
    sendDefaultPii: false, // don't auto-attach IPs / cookies / headers
    serverName: service, // override os.hostname() (a container hex) with the service name
    initialScope: { tags: { service } },
    beforeSend: scrubEvent,
  });
  enabled = true;
  console.log(`[boot] Sentry/GlitchTip enabled (env=${env.NODE_ENV}, service=${service})`);
  return true;
}

export function isSentryEnabled(): boolean {
  return enabled;
}

/** Capture a handled error (no-op when disabled). `extra` is PII-scrubbed too. */
export function captureException(error: unknown, extra?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(error, extra ? { extra } : undefined);
}

/** Flush queued events before shutdown. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // best-effort
  }
}
