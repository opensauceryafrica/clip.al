'use server';

import { verifyTurnstile } from '@clipal/auth';
import { rateLimitMany } from '@clipal/cache';
import { getPublicBaseUrl, limits } from '@clipal/config';
import { createLink } from '@clipal/shorten';
import { headers } from 'next/headers';
import type { ShortenState } from '@/lib/action-state';
import { getSessionUser } from '@/lib/auth';
import { addClaimableLink } from '@/lib/claim';
import { getClientIp, getUserAgent } from '@/lib/request';

export async function shortenAction(
  _prev: ShortenState,
  formData: FormData,
): Promise<ShortenState> {
  const url = String(formData.get('url') ?? '').trim();
  const token = formData.get('cf-turnstile-response');
  const h = await headers();
  const ip = getClientIp(h);
  const ua = getUserAgent(h);
  const user = await getSessionUser();

  // Turnstile is required on anonymous shortening.
  if (!user) {
    const passed = await verifyTurnstile(typeof token === 'string' ? token : null, ip);
    if (!passed) {
      return { ok: false, error: 'Captcha verification failed. Please try again.' };
    }
  }

  // Rate limit (per-IP for anon, per-user for authed), hour + day windows.
  const rl = user
    ? await rateLimitMany('shorten:user', user.id, limits.authedShorten)
    : await rateLimitMany('shorten:anon', ip, limits.anonShorten);
  if (!rl.ok) {
    return { ok: false, error: 'You’re shortening too fast — please try again later.' };
  }

  const result = await createLink({
    destination: url,
    ownerId: user?.id ?? null,
    creatorIp: ip,
    creatorUserAgent: ua,
  });
  if (!result.ok) return { ok: false, error: result.message };

  // Let an anon creator claim this link after signing in within 24h.
  if (!user) await addClaimableLink(result.id);

  return {
    ok: true,
    shortUrl: `${getPublicBaseUrl()}/${result.code}`,
    code: result.code,
    flagged: result.flaggedForReview,
    anonymous: !user,
  };
}
