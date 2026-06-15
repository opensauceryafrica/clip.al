import { validateSession } from '@clipal/auth';
import { CODE_REGEX } from '@clipal/config/constants';
import { SESSION_COOKIE_NAME } from '@clipal/config/constants';
import { lookupCountry } from '@clipal/geo';
import { resolveHostDomain } from '@/lib/domain-context';
import { enqueueClick, type ClickEvent } from '@/lib/click-queue';
import { goneDisabled, notFound, unavailable } from '@/lib/gone-pages';
import { recordLostClick } from '@/lib/metrics';
import { abCookieName, getClientIp, getUserAgent, parseCookies } from '@/lib/request';
import { pwCookieName, verifyPwCookie } from '@/lib/pw';
import {
  allowClick,
  classifyDevice,
  isExpired,
  resolveCachedLink,
  resolveDestination,
} from '@/lib/resolve';

/**
 * The redirect hot path (§9) — extended in Phase 2 with power-link gates that all
 * run AFTER the single Redis lookup and BEFORE the 302, O(1) each (§ AC9):
 * expiry, password proof, click-limit (one Lua round-trip, only when capped) and
 * geo/device/A-B routing (in-memory). Still a pure Response — no React, no ORM.
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
    // Only honour the override for an authenticated admin/moderator (AC4 debug aid).
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
  if (!CODE_REGEX.test(code)) return notFound();

  // Namespace by Host (§6). Default host → null (no I/O); custom domain → its id.
  const domainId = await resolveHostDomain(request.headers.get('host'));

  let result;
  try {
    result = await withTimeout(resolveCachedLink(code, domainId), 600);
  } catch {
    return unavailable();
  }
  if (result.kind === 'not_found') return notFound();
  if (result.kind === 'disabled') return goneDisabled();

  const link = result.link;
  const now = Date.now();

  // 1. Expiry / click-limit-by-time gates (from the cached payload — free).
  if (isExpired(link, now)) return redirectTo(`/p/${code}/expired`);

  // 2. Password gate: no valid proof cookie → send to the interstitial form.
  if (link.hasPassword) {
    const cookies = parseCookies(request.headers);
    if (!verifyPwCookie(code, cookies.get(pwCookieName(code)), now)) {
      return redirectTo(`/p/${code}`);
    }
  }

  // 3. Interstitial owners: the /p page renders + enqueues the click (not here).
  if (link.interstitial) return redirectTo(`/p/${code}`);

  // 4. Direct redirect. Click-limit (one Lua round-trip, only when capped).
  if (link.maxClicks !== null) {
    const allowed = await allowClick(code, link.maxClicks, link.clicksTotal).catch(() => true);
    if (!allowed) return redirectTo(`/p/${code}/blocked`);
  }

  // 5. Resolve the destination (geo/device/A-B). Country/device are cheap.
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

  // 6. Fire-and-forget click enqueue, then redirect.
  const url = new URL(request.url);
  const click: ClickEvent = {
    code,
    linkId: link.id,
    ownerId: link.owner,
    ip,
    ua,
    referrer: request.headers.get('referer') ?? '',
    isInterstitial: 0,
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
