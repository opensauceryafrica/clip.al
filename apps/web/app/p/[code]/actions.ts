'use server';

import { keys, rateLimit, redis } from '@clipal/cache';
import { REPORT_AUTO_REVIEW_THRESHOLD } from '@clipal/config/constants';
import { db, eq, linkReports, links, sql } from '@clipal/db';
import { headers } from 'next/headers';
import type { ReportState } from '@/lib/action-state';
import { getSessionUser } from '@/lib/auth';
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
