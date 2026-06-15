'use server';

import { verifyCode } from '@clipal/auth';
import { keys, rateLimit, redis } from '@clipal/cache';
import { isProd } from '@clipal/config';
import { CODE_REGEX, REPORT_AUTO_REVIEW_THRESHOLD } from '@clipal/config/constants';
import { db, eq, linkReports, links, sql } from '@clipal/db';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { FormActionState, ReportState } from '@/lib/action-state';
import { getSessionUser } from '@/lib/auth';
import { issuePwCookieValue, pwCookieName } from '@/lib/pw';
import { getClientIp } from '@/lib/request';

const REASONS = ['phishing', 'malware', 'spam', 'nsfw', 'illegal', 'other'] as const;
type Reason = (typeof REASONS)[number];

/**
 * Abuse report from the interstitial (§15). Inserts a link_reports row and
 * increments report_count; once it reaches the threshold and the link isn't
 * already malicious, the link is moved to pending_review and its hot cache is
 * invalidated (instant 410). Implemented as a CSRF-safe server action rather
 * than a POST route (§23 prefers actions).
 */
export async function reportLinkAction(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const code = String(formData.get('code') ?? '');
  const reason = String(formData.get('reason') ?? '') as Reason;
  const note = String(formData.get('note') ?? '').trim().slice(0, 1000);
  if (!REASONS.includes(reason)) return { ok: false, error: 'Please choose a reason.' };

  const [link] = await db
    .select({ id: links.id, reportCount: links.reportCount, safetyState: links.safetyState })
    .from(links)
    .where(eq(links.code, code))
    .limit(1);
  if (!link) return { ok: false, error: 'That link no longer exists.' };

  const ip = getClientIp(await headers());
  // Limit how much one IP can move the needle on a single link (threshold is 5).
  const rl = await rateLimit(keys.rateLimit('report', `${ip}:${code}`), 3, 86_400);
  if (!rl.ok) return { ok: true }; // silently accept repeats without counting them

  const user = await getSessionUser();
  await db.insert(linkReports).values({
    linkId: link.id,
    reason,
    note: note || null,
    reporterIp: ip,
    reporterUserId: user?.id ?? null,
  });

  const newCount = link.reportCount + 1;
  const moveToReview = newCount >= REPORT_AUTO_REVIEW_THRESHOLD && link.safetyState !== 'malicious';
  await db
    .update(links)
    .set({
      reportCount: sql`${links.reportCount} + 1`,
      ...(moveToReview ? { status: 'pending_review' as const } : {}),
    })
    .where(eq(links.id, link.id));

  if (moveToReview) {
    await redis.set(keys.hotLink(code), 'DISABLED', 'EX', 300).catch(() => {});
  }

  return { ok: true };
}

/**
 * Verify a visitor's password for a protected link (§8 / spec §5). On success
 * we mint the short-lived signed proof cookie (`clipal_pw_{code}`, 1h, httpOnly)
 * and bounce back to the interstitial, which now reveals the destination. On
 * failure we return an error to re-render the form.
 *
 * Contract:
 *   submitPasswordAction(prev: FormActionState, formData: FormData)
 *     formData.code     — the link code (hidden field)
 *     formData.password — the visitor's attempt
 *   → { error } on a bad password / rate-limit / unknown link
 *   → redirect('/p/{code}') on success (throws, never returns)
 *
 * Brute-force is bounded by a sliding-window limiter keyed per code+ip
 * (10 attempts / 15 min) BEFORE the expensive argon2 verify, so a flood can't
 * even reach the hash.
 */
export async function submitPasswordAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const code = String(formData.get('code') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!CODE_REGEX.test(code)) return { error: 'That link no longer exists.' };
  if (!password) return { error: 'Enter the password to continue.' };

  const hdrs = await headers();
  const ip = getClientIp(hdrs);

  // Rate-limit attempts per code+ip (10 / 15 min) — checked before argon2 so a
  // brute-force flood is rejected cheaply and can't pin a CPU core hashing.
  const rl = await rateLimit(keys.rateLimit('pw', `${ip}:${code}`), 10, 15 * 60);
  if (!rl.ok) {
    return { error: 'Too many attempts. Wait a few minutes and try again.' };
  }

  const [link] = await db
    .select({ id: links.id, passwordHash: links.passwordHash })
    .from(links)
    .where(eq(links.code, code))
    .limit(1);
  if (!link || !link.passwordHash) {
    return { error: 'That link no longer exists.' };
  }

  const ok = await verifyCode(link.passwordHash, password);
  if (!ok) return { error: 'Incorrect password.' };

  // Mint the proof cookie. Read the clock here and feed it to the issuer.
  const { value, maxAge } = issuePwCookieValue(code, Date.now());
  const store = await cookies();
  store.set(pwCookieName(code), value, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });

  // The proof lives in the cookie, not the cache, so no cache invalidation is
  // needed here. Bounce back to the interstitial, which will now pass the
  // password gate and reveal the destination.
  redirect(`/p/${code}`);
}
