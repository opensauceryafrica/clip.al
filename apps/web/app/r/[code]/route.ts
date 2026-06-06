import { keys, redis } from '@clipal/cache';
import { CODE_REGEX } from '@clipal/config/constants';
import { enqueueClick, type ClickEvent } from '@/lib/click-queue';
import { goneDisabled, goneSafety, notFound, unavailable } from '@/lib/gone-pages';
import { lookupLink } from '@/lib/hotpath';
import { recordLostClick } from '@/lib/metrics';
import { getClientIp, getUserAgent } from '@/lib/request';

/**
 * The redirect hot path (§9). The single most important route in the product.
 *
 * Rules it obeys:
 *  - Node runtime, NOT Edge (self-hosted). Excluded from global middleware.
 *  - Does as little as possible; never blocks on the DB for cached links.
 *  - Pure `Response` — no React, no heavy imports, no ORM (uses a dedicated raw
 *    pg pool + a shared Redis connection opened once at module load).
 *  - Even bots get redirected; analytics tagging/bot-drop happens in the worker.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CachedLink {
  url: string;
  interstitial: boolean;
  safety: string;
  id: string;
  owner: string | null;
}

/** Race a promise against a timeout so a slow/down backend can't stall /r. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

function cacheSet(key: string, value: string, ttlSec: number): void {
  // Fire-and-forget; a cache write failure must never affect the response.
  redis.set(key, value, 'EX', ttlSec).catch(() => {});
}

function redirectTo(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await ctx.params;

  // 1. Validate shape before touching any backend.
  if (!CODE_REGEX.test(code)) return notFound();

  const cacheKey = keys.hotLink(code);

  // 2. Redis lookup (with a hard timeout — if Redis is slow/down we fall through
  //    to Postgres rather than stalling the redirect, per §10's failure mode).
  let cached: string | null = null;
  try {
    cached = await withTimeout(redis.get(cacheKey), 300);
  } catch {
    cached = null;
  }

  let link: CachedLink | null = null;
  if (cached === 'DISABLED') {
    return goneDisabled();
  } else if (cached) {
    try {
      link = JSON.parse(cached) as CachedLink;
    } catch {
      link = null; // corrupt cache entry — re-resolve from Postgres.
    }
  }

  // 3. Cache miss → single indexed Postgres lookup.
  if (!link) {
    let row;
    try {
      row = await withTimeout(lookupLink(code), 300);
    } catch {
      return unavailable(); // Postgres unreachable and not cached — can't resolve.
    }
    if (!row) return notFound();

    if (row.status !== 'active') {
      cacheSet(cacheKey, 'DISABLED', 300);
      return goneDisabled();
    }
    if (row.safety_state === 'suspicious' || row.safety_state === 'malicious') {
      cacheSet(cacheKey, 'DISABLED', 300);
      return goneSafety();
    }

    link = {
      url: row.destination_url,
      interstitial: row.interstitial_required,
      safety: row.safety_state,
      id: row.id,
      owner: row.owner_id,
    };
    cacheSet(cacheKey, JSON.stringify(link), 3600);
  }

  // 4. Interstitial or direct?
  if (link.interstitial) {
    // /p will render the preview and enqueue the click — do NOT enqueue here.
    // RELATIVE Location: the browser resolves it against the origin it requested,
    // so this never leaks the request Host header (a container hostname in Docker).
    return redirectTo(`/p/${code}`);
  }

  // Direct: fire-and-forget click enqueue, then redirect.
  const url = new URL(request.url);
  const click: ClickEvent = {
    code,
    linkId: link.id,
    ownerId: link.owner,
    ip: getClientIp(request.headers),
    ua: getUserAgent(request.headers),
    referrer: request.headers.get('referer') ?? '',
    isInterstitial: 0,
    utmSource: url.searchParams.get('utm_source') ?? '',
    utmMedium: url.searchParams.get('utm_medium') ?? '',
    utmCampaign: url.searchParams.get('utm_campaign') ?? '',
    ts: Date.now(),
  };
  enqueueClick(click).catch(() => recordLostClick());

  return redirectTo(link.url);
}
