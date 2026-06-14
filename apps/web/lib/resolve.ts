import { keys, redis } from '@clipal/cache';
import { lookupDestinations, lookupLink, type LinkRow } from './hotpath';

/**
 * The centralized link resolver shared by the redirect hot path (`/r`) and the
 * interstitial (`/p`). It owns the Redis cache payload shape and the O(1)
 * power-link gates (expiry, click-limit, password, geo/device/AB routing).
 *
 * Latency contract (§9, AC9): on a cache HIT — the warm path the benchmark
 * measures — everything needed lives in the JSON payload, so resolution adds
 * ZERO datastore round-trips beyond the single Redis GET. The click-limit Lua
 * adds exactly one round-trip and ONLY for links that set `max_clicks`.
 */

export type RoutingMode = 'single' | 'geo' | 'device' | 'ab';
export type DeviceClass = 'mobile' | 'tablet' | 'desktop' | 'bot';

export type DestinationMatch =
  | { type: 'geo'; countries: string[] }
  | { type: 'device'; device: DeviceClass }
  | { type: 'ab'; weight: number };

export interface Rule {
  match: DestinationMatch;
  url: string;
  order: number;
}

export interface CachedLink {
  id: string;
  url: string; // default / fallback destination
  owner: string | null;
  interstitial: boolean;
  safety: string;
  domainId: string | null;
  expiresAt: number | null; // epoch ms; null = never expires
  maxClicks: number | null;
  clicksTotal: number; // denormalized seed for the click-limit counter
  hasPassword: boolean;
  routingMode: RoutingMode;
  rules: Rule[]; // empty unless routingMode != 'single'
}

const HOT_TTL = 3600;
const DISABLED_TTL = 300;

function cacheSet(key: string, value: string, ttlSec: number): void {
  redis.set(key, value, 'EX', ttlSec).catch(() => {});
}

function isRoutingMode(v: string): v is RoutingMode {
  return v === 'single' || v === 'geo' || v === 'device' || v === 'ab';
}

async function buildCachedLink(row: LinkRow): Promise<CachedLink> {
  const routingMode = isRoutingMode(row.routing_mode) ? row.routing_mode : 'single';
  let rules: Rule[] = [];
  if (routingMode !== 'single') {
    const rows = await lookupDestinations(row.id);
    rules = rows.map((r) => ({ match: r.match as DestinationMatch, url: r.destination_url, order: r.order }));
  }
  return {
    id: row.id,
    url: row.destination_url,
    owner: row.owner_id,
    interstitial: row.interstitial_required,
    safety: row.safety_state,
    domainId: row.domain_id,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    maxClicks: row.max_clicks,
    clicksTotal: Number(row.clicks_total) || 0,
    hasPassword: row.has_password,
    routingMode,
    rules,
  };
}

/** Normalize a parsed cache entry — tolerant of pre-Phase-2 payloads missing fields. */
function normalize(c: Partial<CachedLink> & { id: string; url: string }): CachedLink {
  return {
    id: c.id,
    url: c.url,
    owner: c.owner ?? null,
    interstitial: c.interstitial ?? true,
    safety: c.safety ?? 'unchecked',
    domainId: c.domainId ?? null,
    expiresAt: c.expiresAt ?? null,
    maxClicks: c.maxClicks ?? null,
    clicksTotal: c.clicksTotal ?? 0,
    hasPassword: c.hasPassword ?? false,
    routingMode: c.routingMode && isRoutingMode(c.routingMode) ? c.routingMode : 'single',
    rules: c.rules ?? [],
  };
}

export type ResolveResult =
  | { kind: 'ok'; link: CachedLink }
  | { kind: 'disabled' }
  | { kind: 'not_found' };

/**
 * Cache → Postgres → build → cache. Returns the active link payload, or a
 * terminal `disabled`/`not_found`. Time-based gates (expiry/limit) are NOT baked
 * as disabled here — they are checked per-request by the caller from the payload,
 * so extending an expiry takes effect on the next cache refresh without a stale
 * DISABLED entry pinning the link off.
 */
export async function resolveCachedLink(code: string): Promise<ResolveResult> {
  const key = keys.hotLink(code);
  let cached: string | null = null;
  try {
    cached = await redis.get(key);
  } catch {
    cached = null;
  }
  if (cached === 'DISABLED') return { kind: 'disabled' };
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as Partial<CachedLink> & { id: string; url: string };
      if (parsed.id && parsed.url) return { kind: 'ok', link: normalize(parsed) };
    } catch {
      // fall through to DB
    }
  }

  const row = await lookupLink(code);
  if (!row) return { kind: 'not_found' };
  if (row.status !== 'active') {
    cacheSet(key, 'DISABLED', DISABLED_TTL);
    return { kind: 'disabled' };
  }
  if (row.safety_state === 'suspicious' || row.safety_state === 'malicious') {
    cacheSet(key, 'DISABLED', DISABLED_TTL);
    return { kind: 'disabled' };
  }

  const link = await buildCachedLink(row);
  cacheSet(key, JSON.stringify(link), HOT_TTL);
  return { kind: 'ok', link };
}

// ---- O(1) gates -------------------------------------------------------------

export function isExpired(link: CachedLink, nowMs: number): boolean {
  return link.expiresAt !== null && nowMs > link.expiresAt;
}

/**
 * Authoritative click-limit gate. A Lua script seeds the Redis counter from the
 * link's known total on first use, then INCRs only if still below the cap —
 * returning -1 when the cap is already reached. One round-trip; runs ONLY for
 * links that set max_clicks. Fails OPEN (allows) on any Redis error so a blip
 * never breaks redirects.
 */
const LIMIT_LUA = `
local cur = redis.call('GET', KEYS[1])
if not cur then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  cur = ARGV[2]
end
cur = tonumber(cur)
if cur >= tonumber(ARGV[1]) then return -1 end
return redis.call('INCR', KEYS[1])
`;

export async function allowClick(code: string, maxClicks: number, seedTotal: number): Promise<boolean> {
  try {
    const res = (await redis.eval(
      LIMIT_LUA,
      1,
      keys.clickLimit(code),
      String(maxClicks),
      String(seedTotal),
      String(60 * 60 * 24 * 30), // 30d TTL; refreshed implicitly while active
    )) as number;
    return res !== -1;
  } catch {
    return true; // fail open
  }
}

// ---- Routing ----------------------------------------------------------------

export function classifyDevice(ua: string): DeviceClass {
  const s = ua.toLowerCase();
  if (/bot|crawl|spider|slurp|lighthouse|headless|facebookexternalhit|preview|monitor/.test(s)) {
    return 'bot';
  }
  if (/ipad|tablet|kindle|playbook|silk/.test(s) || (/android/.test(s) && !/mobile/.test(s))) {
    return 'tablet';
  }
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/.test(s)) return 'mobile';
  return 'desktop';
}

export interface RouteCtx {
  country: string; // ISO-2 or 'ZZ'
  device: DeviceClass;
  abVariant: number | null; // sticky variant index from cookie, if any
}

export interface RouteResult {
  url: string;
  setAbVariant?: number; // when set, caller should persist the AB cookie
}

/** Weighted pick over AB rules; returns the chosen rule index. `rand` in [0,1). */
function pickWeighted(rules: Rule[], rand: number): number {
  const weights = rules.map((r) => (r.match.type === 'ab' ? Math.max(0, r.match.weight) : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let t = rand * total;
  for (let i = 0; i < weights.length; i++) {
    t -= weights[i] ?? 0;
    if (t < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Resolve the final destination for a request. Pure + synchronous (no I/O) — the
 * country/device are precomputed by the caller. For AB, returns `setAbVariant`
 * when a new sticky choice should be written to the visitor's cookie.
 */
export function resolveDestination(link: CachedLink, ctx: RouteCtx, rand: number): RouteResult {
  if (link.routingMode === 'single' || link.rules.length === 0) return { url: link.url };

  if (link.routingMode === 'geo') {
    for (const r of link.rules) {
      if (r.match.type === 'geo' && r.match.countries.includes(ctx.country)) return { url: r.url };
    }
    return { url: link.url };
  }

  if (link.routingMode === 'device') {
    for (const r of link.rules) {
      if (r.match.type === 'device' && r.match.device === ctx.device) return { url: r.url };
    }
    return { url: link.url };
  }

  // A/B: sticky variant if the cookie already chose one and it's still valid.
  if (ctx.abVariant !== null && ctx.abVariant >= 0 && ctx.abVariant < link.rules.length) {
    const chosen = link.rules[ctx.abVariant];
    if (chosen) return { url: chosen.url };
  }
  const idx = pickWeighted(link.rules, rand);
  const chosen = link.rules[idx];
  return { url: chosen ? chosen.url : link.url, setAbVariant: idx };
}
