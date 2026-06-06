import 'server-only';
import { validateSession, type SessionUser } from '@clipal/auth';
import { env, isProd } from '@clipal/config';
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from '@clipal/config/constants';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

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
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    // Scope to the apex in prod so *.clip.al shares the session. (This is why we
    // can't use the __Host- prefix, which forbids a Domain attribute — §14.4.)
    ...(isProd ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
