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
