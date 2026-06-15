import { ch } from './client';
import type { DailyClicks, NamedCount, RecentClick } from './types';

/**
 * Dashboard/admin analytics. Every query is parameterized via ClickHouse
 * `{name:Type}` bindings — no string interpolation of user input. Per-link
 * queries filter on link_code (the ORDER BY prefix), so they're range scans.
 *
 * `is_bot = 0` excludes bot traffic from human-facing counts (bots are still
 * stored, just not billed/shown by default).
 */

async function rows<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
  const rs = await ch.query({ query, query_params: params, format: 'JSONEachRow' });
  return rs.json<T>();
}

// ---- Per-link (link detail page) -------------------------------------------

// `codes` is the link's current back-half plus any previous ones, so analytics
// span renames (ClickHouse is keyed by link_code). `link_code IN (…)` stays a
// range scan over the ORDER BY prefix for each code.
export function linkClicksByDay(codes: string[], days = 30): Promise<DailyClicks[]> {
  return rows<DailyClicks>(
    `SELECT toString(toDate(ts)) AS day, count() AS clicks, uniqExact(ip_hash) AS uniques
     FROM clicks
     WHERE link_code IN {codes:Array(String)}
       AND ts >= now() - INTERVAL {days:UInt32} DAY
       AND is_bot = 0
     GROUP BY day ORDER BY day`,
    { codes, days },
  );
}

export function linkTopCountries(codes: string[], days = 30, limit = 10): Promise<NamedCount[]> {
  return rows<NamedCount>(
    `SELECT country AS name, count() AS clicks
     FROM clicks
     WHERE link_code IN {codes:Array(String)} AND ts >= now() - INTERVAL {days:UInt32} DAY AND is_bot = 0
     GROUP BY name ORDER BY clicks DESC LIMIT {limit:UInt32}`,
    { codes, days, limit },
  );
}

export function linkTopReferrers(codes: string[], days = 30, limit = 10): Promise<NamedCount[]> {
  return rows<NamedCount>(
    `SELECT if(referrer_host = '', 'direct', referrer_host) AS name, count() AS clicks
     FROM clicks
     WHERE link_code IN {codes:Array(String)} AND ts >= now() - INTERVAL {days:UInt32} DAY AND is_bot = 0
     GROUP BY name ORDER BY clicks DESC LIMIT {limit:UInt32}`,
    { codes, days, limit },
  );
}

export function linkDevices(codes: string[], days = 30): Promise<NamedCount[]> {
  return rows<NamedCount>(
    `SELECT device AS name, count() AS clicks
     FROM clicks
     WHERE link_code IN {codes:Array(String)} AND ts >= now() - INTERVAL {days:UInt32} DAY AND is_bot = 0
     GROUP BY name ORDER BY clicks DESC`,
    { codes, days },
  );
}

export function linkRecentClicks(codes: string[], limit = 100): Promise<RecentClick[]> {
  return rows<RecentClick>(
    `SELECT toString(ts) AS ts, country, city, device, ua_family, ua_os, referrer_host,
            is_bot, is_interstitial
     FROM clicks
     WHERE link_code IN {codes:Array(String)}
     ORDER BY ts DESC LIMIT {limit:UInt32}`,
    { codes, limit },
  );
}

// ---- Per-campaign (campaign detail) ----------------------------------------

/**
 * Human (is_bot=0) click totals grouped by `link_code` over `days`, for the set
 * of codes belonging to a campaign's links. The campaign detail page maps each
 * returned `{ name: code, clicks }` back to its link (a link may contribute
 * several codes via renames — sum them caller-side). This is the per-LINK figure;
 * TRUE per-VARIANT attribution is Phase 3 (the click event does not yet carry the
 * served A/B variant), so do NOT split this by destination.
 */
export function campaignClicksByCode(
  codes: string[],
  days = 30,
): Promise<NamedCount[]> {
  if (codes.length === 0) return Promise.resolve([]);
  return rows<NamedCount>(
    `SELECT link_code AS name, count() AS clicks
     FROM clicks
     WHERE link_code IN {codes:Array(String)}
       AND ts >= now() - INTERVAL {days:UInt32} DAY
       AND is_bot = 0
     GROUP BY name`,
    { codes, days },
  );
}

// ---- Per-owner (dashboard headline) ----------------------------------------

export async function ownerClicksToday(ownerId: string): Promise<number> {
  const [row] = await rows<{ c: string }>(
    `SELECT count() AS c FROM clicks
     WHERE owner_id = {owner:UUID} AND toDate(ts) = today() AND is_bot = 0`,
    { owner: ownerId },
  );
  return row ? Number(row.c) : 0;
}

export function ownerTopLinks(ownerId: string, limit = 5): Promise<NamedCount[]> {
  return rows<NamedCount>(
    `SELECT link_code AS name, count() AS clicks FROM clicks
     WHERE owner_id = {owner:UUID} AND is_bot = 0
     GROUP BY name ORDER BY clicks DESC LIMIT {limit:UInt32}`,
    { owner: ownerId, limit },
  );
}

// ---- Platform-wide (admin overview) ----------------------------------------

export async function clicksToday(): Promise<number> {
  const [row] = await rows<{ c: string }>(
    `SELECT count() AS c FROM clicks WHERE toDate(ts) = today() AND is_bot = 0`,
    {},
  );
  return row ? Number(row.c) : 0;
}
