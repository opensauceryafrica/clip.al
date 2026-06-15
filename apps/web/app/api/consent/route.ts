/**
 * POST /api/consent — persist the visitor's cookie-consent choice (§10, §14.5).
 *
 * Body: JSON `{ ads: boolean }`. Writes the canonical `clipal_consent` cookie
 * (1-year, lax, host/apex-scoped to match the session cookie) capturing
 * `{ ads, ts }` via {@link encodeConsent}. The client banner can also write the
 * same cookie directly with `document.cookie`; this endpoint exists so the
 * choice survives even when client JS is restricted, and so the value is shaped
 * identically on the server.
 *
 * CSRF: same-origin only (§14.5) — this is a state-changing route handler.
 * The consent cookie is intentionally NOT httpOnly: the banner reads it client
 * side to decide whether to show itself, and it carries no security-sensitive
 * data (just an advertising opt-in flag + timestamp).
 *
 * Node runtime: uses next/headers cookies().
 */
import { env, getPublicBaseUrl } from '@clipal/config';
import { cookies } from 'next/headers';
import { isSameOrigin } from '@/lib/csrf';
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, encodeConsent } from '@/lib/consent';

export const runtime = 'nodejs';

/**
 * Cookie scope mirrored from the session cookie (lib/auth): `secure` follows the
 * public APP_URL scheme, and `domain` is set to the apex only when actually
 * served from COOKIE_DOMAIN so *.clip.al shares the choice. Anywhere else we emit
 * a host-only cookie (a Domain=clip.al cookie on localhost is rejected).
 */
function consentCookieScope(): { secure: boolean; domain?: string } {
  let host: string;
  let secure: boolean;
  try {
    const url = new URL(getPublicBaseUrl());
    host = url.hostname.toLowerCase();
    secure = url.protocol === 'https:';
  } catch {
    return { secure: false };
  }
  const base = env.COOKIE_DOMAIN.replace(/^\./, '').toLowerCase();
  const servedFromBase = !!base && (host === base || host.endsWith(`.${base}`));
  return servedFromBase ? { secure, domain: base } : { secure };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return json({ error: 'forbidden' }, 403);
  }

  let ads: boolean;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || typeof (body as { ads?: unknown }).ads !== 'boolean') {
      return json({ error: 'expected { ads: boolean }' }, 400);
    }
    ads = (body as { ads: boolean }).ads;
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  const { secure, domain } = consentCookieScope();
  const store = await cookies();
  store.set(CONSENT_COOKIE, encodeConsent(ads), {
    // NOT httpOnly — the banner reads this client-side to stay hidden (see file
    // header). Carries no auth data, only the advertising opt-in flag.
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: CONSENT_MAX_AGE_SECONDS,
    ...(domain ? { domain } : {}),
  });

  return json({ ok: true, ads }, 200);
}
