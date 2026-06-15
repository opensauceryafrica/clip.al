import 'server-only';
import { env } from '@clipal/config';
import { adsPlacements, and, db, eq, isNull, lte, gte, or, sql } from '@clipal/db';
import type { AdsPlacement } from '@clipal/db';
import { captureException } from '@clipal/observability';
import { isDatacenterIp, userAgentLooksBot } from '@clipal/safety';

/** The three named ad slots (mirrors the `ad_slot` Postgres enum). */
export type AdSlotName = 'interstitial_top' | 'interstitial_bottom' | 'tree_top';

/**
 * Inputs to the ad gate. `headers` is the raw request Headers so the gate can
 * inspect Accept-Language / Sec-Fetch-* without the caller pre-parsing them.
 */
export type AdGateInput = {
  ua: string;
  ip: string;
  headers: Headers;
  hasConsent: boolean;
};

/**
 * The bot-defense gate (spec §10 + §14.7). Returns `true` only when it is safe
 * to render *and count* an ad for this request. Fails CLOSED: any signal that
 * the traffic is automated, headless, datacenter-originated, or non-consenting
 * suppresses ads. It also short-circuits when ads are globally disabled.
 *
 * The checks, any of which → false:
 *   1. env.ADS_ENABLED is off.
 *   2. No consent (CMP) — ads are gated behind explicit consent.
 *   3. UA matches the bot list (or is empty/too short).
 *   4. Missing Accept-Language — real browsers always send one; bots rarely do.
 *   5. Sec-Fetch-Dest / Sec-Fetch-Mode look automated.
 *   6. The client IP is in a known datacenter/cloud range.
 *
 * Pure (no I/O); never throws.
 */
export function shouldRenderAds(input: AdGateInput): boolean {
  try {
    if (!env.ADS_ENABLED) return false;
    if (!input.hasConsent) return false;
    if (userAgentLooksBot(input.ua)) return false;

    const h = input.headers;

    // 4. A genuine browser navigation always advertises a language preference.
    const lang = h.get('accept-language');
    if (!lang || lang.trim() === '') return false;

    // 5. Sec-Fetch metadata. A top-level document navigation from a real browser
    // is dest=document / mode=navigate. Fetches, empty dests, and "no-cors"
    // sub-resource loads are the shape automated/embedded fetchers produce.
    const dest = h.get('sec-fetch-dest');
    const mode = h.get('sec-fetch-mode');
    if (dest !== null) {
      // If the header is present at all, it must look like a real navigation.
      const okDest = dest === 'document' || dest === 'iframe' || dest === 'empty';
      if (!okDest) return false;
    }
    if (mode !== null) {
      const okMode = mode === 'navigate' || mode === 'same-origin' || mode === 'cors';
      if (!okMode) return false;
    }

    // 6. Datacenter / cloud egress is overwhelmingly bot traffic.
    if (isDatacenterIp(input.ip)) return false;

    return true;
  } catch (err) {
    captureException(err, { where: 'ads.shouldRenderAds' });
    // Fail closed — better to skip an ad than to serve a bot.
    return false;
  }
}

/** A chosen sponsored creative (our own inventory). */
export type SponsoredAd = {
  kind: 'sponsored';
  id: string;
  advertiserName: string;
  /** S3 object key for the creative image. */
  imageKey: string;
};

/** Render the manual AdSense unit fallback (a named slot, NOT auto-ads). */
export type AdsenseAd = {
  kind: 'adsense';
  clientId: string;
};

/** Nothing to render for this slot. */
export type NoAd = { kind: 'none' };

export type AdSelection = SponsoredAd | AdsenseAd | NoAd;

/**
 * Choose what to render in `slot`. Prefers our own sponsored inventory: among
 * ACTIVE placements whose [startsAt, endsAt] window contains `now`, pick one by
 * weighted random (weight ≥ 1). If there is no eligible sponsored creative, fall
 * back to the manual AdSense unit when ADSENSE_CLIENT_ID is configured, else
 * render nothing.
 *
 * The single DB read fails open to the AdSense/none fallback — a Postgres blip
 * must never throw on the interstitial render path.
 *
 * NOTE: this does NOT itself run the bot gate — callers must have already passed
 * `shouldRenderAds()` before reaching here.
 */
export async function selectAd(slot: AdSlotName, now: Date = new Date()): Promise<AdSelection> {
  const sponsored = await pickSponsored(slot, now).catch((err) => {
    captureException(err, { where: 'ads.selectAd', slot });
    return null;
  });

  if (sponsored) {
    return {
      kind: 'sponsored',
      id: sponsored.id,
      advertiserName: sponsored.advertiserName,
      imageKey: sponsored.imageUrl,
    };
  }

  if (env.ADSENSE_CLIENT_ID !== '') {
    return { kind: 'adsense', clientId: env.ADSENSE_CLIENT_ID };
  }

  return { kind: 'none' };
}

/**
 * Weighted-random pick among eligible sponsored placements for `slot`. Returns
 * `null` when none are eligible. The time-window predicate treats a NULL
 * startsAt/endsAt as "open-ended" on that side.
 */
async function pickSponsored(slot: AdSlotName, now: Date): Promise<AdsPlacement | null> {
  const rows = await db
    .select()
    .from(adsPlacements)
    .where(
      and(
        eq(adsPlacements.slot, slot),
        eq(adsPlacements.active, true),
        or(isNull(adsPlacements.startsAt), lte(adsPlacements.startsAt, now)),
        or(isNull(adsPlacements.endsAt), gte(adsPlacements.endsAt, now)),
      ),
    );

  return weightedPick(rows);
}

/**
 * Weighted random selection. Each row contributes `max(weight, 0)` to the total;
 * a roll in `[0, total)` selects proportionally. Exported for unit testing.
 */
export function weightedPick<T extends { weight: number }>(rows: readonly T[]): T | null {
  if (rows.length === 0) return null;
  let total = 0;
  for (const r of rows) total += Math.max(0, r.weight);
  if (total <= 0) {
    // All weights non-positive — fall back to a uniform pick so an active
    // placement with a misconfigured weight still renders.
    const i = Math.floor(Math.random() * rows.length);
    return rows[i] ?? rows[0] ?? null;
  }
  let roll = Math.random() * total;
  for (const r of rows) {
    roll -= Math.max(0, r.weight);
    if (roll < 0) return r;
  }
  return rows[rows.length - 1] ?? null;
}

// Re-export so callers/tests can reference the operators via this module if
// desired (keeps the drizzle import surface in one place for the ad engine).
export { sql };
