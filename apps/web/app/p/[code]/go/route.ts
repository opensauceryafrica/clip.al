import { validateSession } from '@clipal/auth';
import { CODE_REGEX, SESSION_COOKIE_NAME } from '@clipal/config/constants';
import { lookupCountry } from '@clipal/geo';
import { enqueueClick, type ClickEvent } from '@/lib/click-queue';
import { recordLostClick } from '@/lib/metrics';
import { pwCookieName, verifyPwCookie } from '@/lib/pw';
import { abCookieName, getClientIp, getUserAgent, parseCookies } from '@/lib/request';
import {
  allowClick,
  classifyDevice,
  isExpired,
  resolveCachedLink,
  resolveDestination,
} from '@/lib/resolve';

/**
 * The interstitial "Continue" target. Brought to PARITY with the `/r` hot path
 * in Phase 2: it runs the same O(1) power-link gates AFTER the single cache
 * lookup and BEFORE the 302 — expiry, password proof, click-limit (one Lua
 * round-trip, only when capped) and geo/device/A-B routing — then enqueues the
 * click (is_interstitial=1) and 302s to the RESOLVED destination.
 *
 * Lives under /p so Caddy supplies X-Real-IP and middleware is bypassed.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

function redirectTo(location: string, extraCookies?: string[]): Response {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  });
  for (const c of extraCookies ?? []) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

/** Resolve the visitor country, honouring an admin-only `?_geo_override=XX`. */
async function resolveCountry(request: Request, ip: string): Promise<string> {
  const override = new URL(request.url).searchParams.get('_geo_override');
  if (override) {
    const token = parseCookies(request.headers).get(SESSION_COOKIE_NAME);
    if (token) {
      try {
        const user = await withTimeout(validateSession(token), 200);
        if (user && (user.role === 'admin' || user.role === 'moderator')) {
          return override.toUpperCase().slice(0, 2);
        }
      } catch {
        /* ignore — fall through to real geo */
      }
    }
  }
  return lookupCountry(ip);
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await ctx.params;
  if (!CODE_REGEX.test(code)) return new Response('Not found', { status: 404 });

  let result;
  try {
    result = await withTimeout(resolveCachedLink(code), 600);
  } catch {
    return new Response('Service unavailable', { status: 503 });
  }
  if (result.kind === 'not_found') return new Response('Not found', { status: 404 });
  if (result.kind === 'disabled') return new Response('Gone', { status: 410 });

  const link = result.link;
  const now = Date.now();

  // 1. Expiry gate — send to the terminal expired page (parity with /r).
  if (isExpired(link, now)) return redirectTo(`/p/${code}/expired`);

  // 2. Password gate — block Continue unless a valid proof cookie is present.
  //    The visitor must clear the form on /p/[code] first.
  if (link.hasPassword) {
    const cookies = parseCookies(request.headers);
    if (!verifyPwCookie(code, cookies.get(pwCookieName(code)), now)) {
      return redirectTo(`/p/${code}`);
    }
  }

  // 3. Click-limit (one Lua round-trip, only when the link is capped).
  if (link.maxClicks !== null) {
    const allowed = await allowClick(code, link.maxClicks, link.clicksTotal).catch(() => true);
    if (!allowed) return redirectTo(`/p/${code}/blocked`);
  }

  // 4. Resolve the destination (geo / device / A-B). Country/device are cheap
  //    and only computed for the relevant routing mode.
  const ip = getClientIp(request.headers);
  const ua = getUserAgent(request.headers);
  let abVariant: number | null = null;
  if (link.routingMode === 'ab') {
    const raw = parseCookies(request.headers).get(abCookieName(code));
    const n = raw !== undefined ? Number(raw) : NaN;
    abVariant = Number.isInteger(n) ? n : null;
  }
  const country = link.routingMode === 'geo' ? await resolveCountry(request, ip) : 'ZZ';
  const device = link.routingMode === 'device' ? classifyDevice(ua) : 'desktop';
  const routed = resolveDestination(link, { country, device, abVariant }, Math.random());

  // 5. Fire-and-forget click enqueue (is_interstitial=1), then 302.
  const url = new URL(request.url);
  const click: ClickEvent = {
    code,
    linkId: link.id,
    ownerId: link.owner,
    ip,
    ua,
    referrer: request.headers.get('referer') ?? '',
    isInterstitial: 1,
    utmSource: url.searchParams.get('utm_source') ?? '',
    utmMedium: url.searchParams.get('utm_medium') ?? '',
    utmCampaign: url.searchParams.get('utm_campaign') ?? '',
    ts: now,
  };
  enqueueClick(click).catch(() => recordLostClick());

  const cookies =
    routed.setAbVariant !== undefined
      ? [`${abCookieName(code)}=${routed.setAbVariant}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`]
      : undefined;
  return redirectTo(routed.url, cookies);
}
