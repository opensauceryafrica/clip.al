'use server';

import { hashPassword } from '@clipal/auth';
import { keys, redis } from '@clipal/cache';
import { type Feature } from '@clipal/config';
import {
  getLinkUsage,
  incrementLinkUsage,
  isPlanRequiredError,
  planLimits,
  requireFeature,
  resolvePlan,
} from '@clipal/billing';
import type { DestinationMatch } from '@clipal/db';
import { db, recordAudit } from '@clipal/db';
import { createLink, type PowerLinkConfig, type PowerRule, type RoutingMode } from '@clipal/shorten';
import { headers } from 'next/headers';
import { requireUser } from '@/lib/auth';
import { getClientIp, getUserAgent } from '@/lib/request';

/**
 * Return shape for {@link createPowerLinkAction}. On success the UI gets the new
 * `code` (build the short URL from it). On a plan gate it gets `code:'plan_required'`
 * plus the gating `feature`; on anything else just `error`.
 */
export interface PowerLinkState {
  ok?: boolean;
  /** On success: the new link's back-half. */
  code?: string;
  /** On a plan gate: 'plan_required'. */
  reason?: 'plan_required';
  /** On a plan gate: the capability that was missing. */
  feature?: Feature;
  error?: string;
}

const ROUTING_MODES: readonly RoutingMode[] = ['single', 'geo', 'device', 'ab'];
const DEVICE_CLASSES = ['mobile', 'tablet', 'desktop', 'bot'] as const;

function isRoutingMode(v: string): v is RoutingMode {
  return (ROUTING_MODES as readonly string[]).includes(v);
}

/** Parse + validate the `rules` JSON for a routing mode into PowerRule[]. */
function parseRules(
  raw: string,
  mode: Exclude<RoutingMode, 'single'>,
): { ok: true; rules: PowerRule[] } | { ok: false; error: string } {
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Routing rules are malformed.' };
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    return { ok: false, error: 'Add at least one routing destination.' };
  }

  const rules: PowerRule[] = [];
  let abWeightTotal = 0;
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i] as Record<string, unknown>;
    const url = typeof r?.url === 'string' ? r.url.trim() : '';
    if (!url) return { ok: false, error: 'Each routing rule needs a destination URL.' };
    const m = r?.match as Record<string, unknown> | undefined;
    if (!m || typeof m !== 'object') return { ok: false, error: 'Each rule needs a match.' };

    let match: DestinationMatch;
    if (mode === 'geo') {
      const countries = Array.isArray(m.countries)
        ? m.countries.filter((c): c is string => typeof c === 'string').map((c) => c.toUpperCase())
        : [];
      if (countries.length === 0) {
        return { ok: false, error: 'Geo rules need at least one country.' };
      }
      match = { type: 'geo', countries };
    } else if (mode === 'device') {
      const device = m.device;
      if (typeof device !== 'string' || !(DEVICE_CLASSES as readonly string[]).includes(device)) {
        return { ok: false, error: 'Device rules need a valid device class.' };
      }
      match = { type: 'device', device: device as (typeof DEVICE_CLASSES)[number] };
    } else {
      // ab
      const weight = Number(m.weight);
      if (!Number.isFinite(weight) || weight < 0) {
        return { ok: false, error: 'A/B weights must be non-negative numbers.' };
      }
      abWeightTotal += weight;
      match = { type: 'ab', weight };
    }
    rules.push({ match, url, order: i });
  }

  if (mode === 'ab' && abWeightTotal <= 0) {
    return { ok: false, error: 'A/B weights must sum to a positive total.' };
  }
  return { ok: true, rules };
}

/**
 * Create a power link (§8). Plan-gates each requested capability up front (custom
 * slug, password, expiry/maxClicks, geo/device/ab routing), validates + parses
 * the inputs, enforces the monthly link quota, then delegates the SAFETY pipeline
 * + persistence to `createLink`. Usage is only incremented on a successful insert.
 *
 * The feature gating is here (not in `createLink`) so the shorten package stays
 * entitlement-free and reusable by the public API.
 */
export async function createPowerLinkAction(
  _prev: PowerLinkState,
  formData: FormData,
): Promise<PowerLinkState> {
  const user = await requireUser();
  const plan = await resolvePlan(user.id);

  const destination = String(formData.get('destination') ?? '').trim();
  if (!destination) return { error: 'Enter a destination URL.' };

  const customSlugRaw = String(formData.get('customSlug') ?? '').trim();
  const passwordRaw = String(formData.get('password') ?? '');
  const expiresAtRaw = String(formData.get('expiresAt') ?? '').trim();
  const maxClicksRaw = String(formData.get('maxClicks') ?? '').trim();
  const routingModeRaw = String(formData.get('routingMode') ?? 'single').trim() || 'single';
  const rulesRaw = String(formData.get('rules') ?? '').trim();
  const campaignIdRaw = String(formData.get('campaignId') ?? '').trim();

  // Determine which features are being used, then plan-gate each.
  if (!isRoutingMode(routingModeRaw)) return { error: 'Unknown routing mode.' };
  const routingMode: RoutingMode = routingModeRaw;

  const usedFeatures: Feature[] = [];
  if (customSlugRaw) usedFeatures.push('customSlugs');
  if (passwordRaw) usedFeatures.push('password');
  if (expiresAtRaw || maxClicksRaw) usedFeatures.push('expiry');
  if (routingMode === 'geo') usedFeatures.push('geoRouting');
  if (routingMode === 'device') usedFeatures.push('deviceRouting');
  if (routingMode === 'ab') usedFeatures.push('abTesting');

  try {
    for (const feature of usedFeatures) requireFeature(plan, feature);
  } catch (err) {
    if (isPlanRequiredError(err)) {
      return { error: err.message, reason: 'plan_required', feature: err.feature };
    }
    throw err;
  }

  // ── Parse + validate the power inputs (post plan-gate). ────────────────────
  const power: PowerLinkConfig = { routingMode };

  if (customSlugRaw) power.customSlug = customSlugRaw;
  if (campaignIdRaw) power.campaignId = campaignIdRaw;

  if (expiresAtRaw) {
    const ts = Date.parse(expiresAtRaw);
    if (Number.isNaN(ts)) return { error: 'Expiry date is invalid.' };
    if (ts <= Date.now()) return { error: 'Expiry must be in the future.' };
    power.expiresAt = new Date(ts);
  }

  if (maxClicksRaw) {
    const n = Number(maxClicksRaw);
    if (!Number.isInteger(n) || n <= 0) return { error: 'Click limit must be a positive whole number.' };
    power.maxClicks = n;
  }

  if (routingMode !== 'single') {
    const parsed = parseRules(rulesRaw, routingMode);
    if (!parsed.ok) return { error: parsed.error };
    power.rules = parsed.rules;
  }

  // Hash the password only after gating + validation pass (argon2 is expensive).
  if (passwordRaw) power.passwordHash = await hashPassword(passwordRaw);

  // ── Monthly link quota (advisory counter; enforced here). ──────────────────
  const limit = planLimits(plan).linksPerMonth;
  if (limit !== null) {
    const used = await getLinkUsage(user.id, new Date());
    if (used >= limit) {
      return { error: `You’ve reached your monthly limit of ${limit} links.` };
    }
  }

  const h = await headers();
  const result = await createLink({
    destination,
    ownerId: user.id,
    creatorIp: getClientIp(h),
    creatorUserAgent: getUserAgent(h),
    power,
    // Pro/Business owners' links skip the interstitial (and its ads) — §10/AC8.
    interstitialRequired: planLimits(plan).interstitialOnOwnedLinks,
  });

  if (!result.ok) {
    if (result.reason === 'slug_taken') return { error: 'That back-half is already taken.' };
    return { error: result.message };
  }

  // Count usage only on a real insert.
  await incrementLinkUsage(user.id, new Date());

  await recordAudit(db, {
    actorId: user.id,
    action: 'link.created',
    targetType: 'link',
    targetId: result.id,
    metadata: {
      code: result.code,
      customSlug: Boolean(power.customSlug),
      password: Boolean(power.passwordHash),
      routingMode,
      ...(power.expiresAt ? { expiresAt: power.expiresAt.toISOString() } : {}),
      ...(power.maxClicks ? { maxClicks: power.maxClicks } : {}),
      ...(power.campaignId ? { campaignId: power.campaignId } : {}),
    },
  });

  // New code: no stale cache should exist, but drop defensively so the resolver
  // reads the fresh row on first hit.
  await redis.del(keys.hotLink(result.code)).catch(() => {});

  return { ok: true, code: result.code };
}
