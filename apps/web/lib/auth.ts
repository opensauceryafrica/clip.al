import 'server-only';
import { validateSession, type SessionUser } from '@clipal/auth';
import { env, getPublicBaseUrl } from '@clipal/config';
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from '@clipal/config/constants';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Cookie scope derived from the actual public origin (APP_URL), NOT from
 * NODE_ENV. This is what makes the session cookie storable in every environment:
 *
 *  - `secure` follows the APP_URL scheme. https://clip.al → secure; a local
 *    prod-image run on http://localhost:3000 → not secure (a Secure cookie would
 *    still store on localhost, but tying it to the scheme keeps things honest).
 *  - `domain` is only set when we are actually being served from COOKIE_DOMAIN
 *    (or a subdomain of it), so *.clip.al can share the session in prod. When
 *    APP_URL is anything else (localhost, an IP, a preview host), we emit a
 *    HOST-ONLY cookie — a `Domain=clip.al` cookie on a localhost page is rejected
 *    by the browser and never stored, which logs the user out on every click.
 */
function sessionCookieScope(): { secure: boolean; domain?: string } {
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

/**
 * Server-side session helpers. The authoritative JWT + revocation check runs
 * here in the Node runtime (the Edge middleware only does a coarse cookie-
 * presence gate). Never import this from a client component.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;
    return await validateSession(token);
  } catch {
    // A backend blip (Redis/Postgres) must never 500 a public page — treat as
    // logged-out. Authed pages still gate via requireUser → redirect to /signin.
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'admin' && user.role !== 'moderator') redirect('/dashboard');
  return user;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  const { secure, domain } = sessionCookieScope();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    // Scope to the apex (e.g. clip.al) only when actually served from it, so
    // *.clip.al shares the session. (This is why we can't use the __Host- prefix,
    // which forbids a Domain attribute — §14.4.)
    ...(domain ? { domain } : {}),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  // Must clear with the same scope it was set with, or a Domain-scoped cookie
  // survives. (Revocation via the Redis denylist is the authoritative logout;
  // this is belt-and-suspenders.)
  const { domain } = sessionCookieScope();
  store.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    ...(domain ? { domain } : {}),
  });
}
