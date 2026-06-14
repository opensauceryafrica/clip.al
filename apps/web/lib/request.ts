/** Helpers for reading the real client from request headers (Caddy sets X-Real-IP). */

export function getClientIp(headers: Headers): string {
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0];
    if (first) return first.trim();
  }
  return '0.0.0.0';
}

export function getUserAgent(headers: Headers): string {
  return headers.get('user-agent') ?? '';
}

/** Parse the Cookie header into a map (hot-path safe — no framework cookie API). */
export function parseCookies(headers: Headers): Map<string, string> {
  const out = new Map<string, string>();
  const raw = headers.get('cookie');
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out.set(k, decodeURIComponent(v));
  }
  return out;
}

/** Sticky A/B variant cookie name for a code (30-day, set on first assignment). */
export function abCookieName(code: string): string {
  return `clipal_ab_${code}`;
}
