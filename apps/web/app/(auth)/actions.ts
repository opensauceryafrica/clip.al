'use server';

import {
  createSession,
  generateCode,
  hashCode,
  verifyCode,
  verifyTurnstile,
} from '@clipal/auth';
import { keys, rateLimit, redis } from '@clipal/cache';
import { env, getPublicBaseUrl, limits } from '@clipal/config';
import {
  AUTH_CODE_MAX_ATTEMPTS,
  AUTH_VERIFY_LOCK_THRESHOLD,
} from '@clipal/config/constants';
import {
  abbrefyMigrations,
  and,
  authCodes,
  db,
  desc,
  eq,
  gt,
  isNull,
  sql,
  users,
} from '@clipal/db';
import { sendVerificationCode, sendWelcomeMigrated } from '@clipal/email';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AuthState } from '@/lib/action-state';
import { setSessionCookie } from '@/lib/auth';
import { claimPendingLinks } from '@/lib/claim';
import { getClientIp, getUserAgent } from '@/lib/request';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_VERIFY_ERROR = 'That code is incorrect or has expired. Request a new one.';

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** /signin — email + Turnstile. Always behaves the same whether or not the email
 * exists (no account enumeration); the email's tone differs, the response doesn't. */
export async function sendCodeAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = normalizeEmail(String(formData.get('email') ?? ''));
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' };

  const h = await headers();
  const ip = getClientIp(h);
  const ua = getUserAgent(h);

  if (!(await verifyTurnstile(String(formData.get('cf-turnstile-response') ?? '') || null, ip))) {
    return { error: 'Captcha verification failed. Please try again.' };
  }

  // Rate limit: per email AND per IP (§8, §14.2).
  const perEmail = await rateLimit(
    keys.rateLimit('authcode:email', email),
    limits.authCodePerEmail.limit,
    limits.authCodePerEmail.windowSec,
  );
  const perIp = await rateLimit(
    keys.rateLimit('authcode:ip', ip),
    limits.authCodePerIp.limit,
    limits.authCodePerIp.windowSec,
  );
  if (!perEmail.ok || !perIp.ok) {
    return { error: 'Too many code requests. Please wait a while and try again.' };
  }

  // Determine purpose. A returning abbrefy user (no users row yet) is still a
  // sign-in — we're claiming their migrated identity (§11).
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  let purpose: 'signin' | 'signup' = existing ? 'signin' : 'signup';
  if (!existing) {
    const [migrated] = await db
      .select({ email: abbrefyMigrations.email })
      .from(abbrefyMigrations)
      .where(eq(abbrefyMigrations.email, email))
      .limit(1);
    if (migrated) purpose = 'signin';
  }

  const code = generateCode();
  const codeHash = await hashCode(code);
  await db.insert(authCodes).values({ email, codeHash, purpose, ip, userAgent: ua });

  await sendVerificationCode(email, { code, ip }).catch((e: unknown) => {
    console.error('[auth] failed to send code', e);
    // DEV-ONLY fallback, strictly on the delivery-FAILED branch: surface the code
    // so local testing can proceed without a verified email domain. This is never
    // reached when delivery succeeds, so real prod (verified domain + working
    // email) never logs codes even if the flag is left on. Gated on the env flag.
    if (env.AUTH_DEV_LOG_CODES_ON_FAIL) {
      console.warn(`[auth] dev-mode code for ${email}: ${code}`);
    }
  });

  redirect(`/verify?email=${encodeURIComponent(email)}`);
}

/** /verify — submit the 6-digit code. */
export async function verifyCodeAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = normalizeEmail(String(formData.get('email') ?? ''));
  const code = String(formData.get('code') ?? '').trim();
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return { error: GENERIC_VERIFY_ERROR };

  const h = await headers();
  const ip = getClientIp(h);
  const ua = getUserAgent(h);

  if (!(await verifyTurnstile(String(formData.get('cf-turnstile-response') ?? '') || null, ip))) {
    return { error: 'Captcha verification failed. Please try again.' };
  }

  // Account lock: ≥10 failed verifies in an hour (§8 hardening).
  const lockKey = keys.verifyAttempts(email);
  const failed = Number((await redis.get(lockKey)) ?? 0);
  if (failed >= AUTH_VERIFY_LOCK_THRESHOLD) {
    return { error: 'Too many attempts. Please wait an hour and request a new code.' };
  }
  const rl = await rateLimit(
    keys.rateLimit('verify', email),
    limits.verifyPerEmail.limit,
    limits.verifyPerEmail.windowSec,
  );
  if (!rl.ok) return { error: 'Too many attempts. Please wait and request a new code.' };

  const [record] = await db
    .select()
    .from(authCodes)
    .where(and(eq(authCodes.email, email), isNull(authCodes.consumedAt), gt(authCodes.expiresAt, sql`now()`)))
    .orderBy(desc(authCodes.createdAt))
    .limit(1);
  if (!record) return { error: GENERIC_VERIFY_ERROR };

  const attempts = record.attempts + 1;
  await db.update(authCodes).set({ attempts }).where(eq(authCodes.id, record.id));
  if (attempts > AUTH_CODE_MAX_ATTEMPTS) {
    await db.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, record.id));
    return { error: GENERIC_VERIFY_ERROR };
  }

  if (!(await verifyCode(record.codeHash, code))) {
    const n = await redis.incr(lockKey);
    if (n === 1) await redis.expire(lockKey, 3600);
    return { error: GENERIC_VERIFY_ERROR };
  }

  // Success — consume the code.
  await db.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, record.id));
  await redis.del(lockKey);

  // Resolve (or create) the user.
  let [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  let welcomeMigrated = false;

  if (!user) {
    const [migration] = await db
      .select({ email: abbrefyMigrations.email })
      .from(abbrefyMigrations)
      .where(eq(abbrefyMigrations.email, email))
      .limit(1);
    const migrated = Boolean(migration);
    const [created] = await db
      .insert(users)
      .values({ email, migratedFromAbbrefy: migrated })
      .returning({ id: users.id });
    if (!created) return { error: 'Could not create your account. Please try again.' };
    user = created;

    if (migrated) {
      welcomeMigrated = true;
      await db
        .update(abbrefyMigrations)
        .set({ claimedByUserId: created.id, claimedAt: new Date() })
        .where(eq(abbrefyMigrations.email, email));
      await sendWelcomeMigrated(email, `${getPublicBaseUrl()}/dashboard`).catch((e: unknown) =>
        console.error('[auth] welcome email failed', e),
      );
    }
  }

  const { token } = await createSession(user.id, ip, ua);
  await setSessionCookie(token);
  await claimPendingLinks(user.id);

  redirect(welcomeMigrated ? '/dashboard?welcome=back' : '/dashboard');
}
