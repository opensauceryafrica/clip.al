import { CODE_REGEX } from '@clipal/config/constants';
import { enqueueClick, type ClickEvent } from '@/lib/click-queue';
import { resolveLink } from '@/lib/links';
import { recordLostClick } from '@/lib/metrics';
import { getClientIp, getUserAgent } from '@/lib/request';

/**
 * The interstitial "Continue" target. Fires the click event (is_interstitial=1)
 * and 302s to the destination. Lives under /p so Caddy supplies X-Real-IP and
 * middleware is bypassed.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await ctx.params;
  if (!CODE_REGEX.test(code)) return new Response('Not found', { status: 404 });

  const link = await resolveLink(code);
  if (
    !link ||
    link.status !== 'active' ||
    link.safetyState === 'malicious' ||
    link.safetyState === 'suspicious'
  ) {
    return new Response('Gone', { status: 410 });
  }

  const url = new URL(request.url);
  const click: ClickEvent = {
    code,
    linkId: link.id,
    ownerId: link.ownerId,
    ip: getClientIp(request.headers),
    ua: getUserAgent(request.headers),
    referrer: request.headers.get('referer') ?? '',
    isInterstitial: 1,
    utmSource: url.searchParams.get('utm_source') ?? '',
    utmMedium: url.searchParams.get('utm_medium') ?? '',
    utmCampaign: url.searchParams.get('utm_campaign') ?? '',
    ts: Date.now(),
  };
  enqueueClick(click).catch(() => recordLostClick());

  return new Response(null, {
    status: 302,
    headers: {
      Location: link.url,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
