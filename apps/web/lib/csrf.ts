import { env } from '@clipal/config';

/**
 * Same-origin check for mutating API route handlers (§14.5). Server actions are
 * CSRF-safe by default in Next 15 and are preferred; this guards the few POST
 * route handlers we keep.
 */
export function isSameOrigin(request: Request): boolean {
  const appOrigin = new URL(env.APP_URL).origin;
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).origin === appOrigin;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === appOrigin;
    } catch {
      return false;
    }
  }
  // No Origin/Referer on a state-changing request — reject.
  return false;
}
