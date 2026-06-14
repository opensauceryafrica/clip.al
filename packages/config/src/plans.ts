/**
 * Plans — the single source of truth for plan names, capabilities, limits and
 * default prices (§3). Consumed across UI, the public API and enforcement.
 *
 * Pure data + types only: NO DB/Redis/env imports. The runtime enforcement
 * helper (`requireFeature`) lives in `packages/billing` and imports the
 * `Feature`/`PlanName` types and the `PLANS`/`hasCapability` data from here.
 *
 * Admin-configurable pricing: the DB `plan_prices` table OVERRIDES
 * `DEFAULT_PRICES` below; treat these as the seed/fallback when no override
 * row exists. `PLANS` capabilities/limits are intentionally code-only (not
 * admin-editable) so feature gating stays auditable.
 */

// ---- Plan names -------------------------------------------------------------

export const planNames = ['free', 'pro', 'business'] as const;
export type PlanName = (typeof planNames)[number];

// ---- Capabilities -----------------------------------------------------------

/**
 * Boolean feature gates. The `Feature` union is the set of capability keys —
 * `requireFeature(user, feature)` in `packages/billing` narrows against it.
 */
export interface PlanCapabilities {
  /** User may choose a custom back-half (§8). */
  customSlugs: boolean;
  /** Password-protected links (§8). */
  password: boolean;
  /** Expiring links (by date or click count) (§8). */
  expiry: boolean;
  /** QR code generation with custom logo/colors (§8). */
  qr: boolean;
  /** Geo-routing destinations (§8). */
  geoRouting: boolean;
  /** Device-routing destinations (§8). */
  deviceRouting: boolean;
  /** A/B testing campaigns (§8). */
  abTesting: boolean;
}

export type Feature = keyof PlanCapabilities;

// ---- Limits -----------------------------------------------------------------

/**
 * Numeric quotas. `null` means unlimited. Enforcement reads these via
 * `PLANS[plan].limits.*`.
 */
export interface PlanLimits {
  /** Links a user may CREATE per calendar month. null = unlimited. */
  linksPerMonth: number | null;
  /** Public API requests per month. 0 = API unavailable. */
  apiRequestsPerMonth: number;
  /** Max active webhook endpoints. 0 = webhooks unavailable. */
  webhooks: number;
  /** Max custom domains. 0 = custom domains unavailable. */
  customDomains: number;
  /** Max rows accepted per bulk CSV import. 0 = bulk import unavailable. */
  bulkImportMax: number;
  /** Max active campaigns (A/B tests). null = unlimited. 0 = unavailable. */
  activeCampaigns: number | null;
  /** Team seats (Phase 2 ships scaffolding only). */
  teamSeats: number;
  /** Whether the interstitial (with ads) is shown on the owner's own links. */
  interstitialOnOwnedLinks: boolean;
  /** How many days of analytics the user can view. */
  analyticsRetentionDays: number;
}

export interface Plan {
  name: PlanName;
  capabilities: PlanCapabilities;
  limits: PlanLimits;
}

export const PLANS: Readonly<Record<PlanName, Plan>> = {
  free: {
    name: 'free',
    capabilities: {
      customSlugs: false,
      password: false,
      expiry: false,
      qr: false,
      geoRouting: false,
      deviceRouting: false,
      abTesting: false,
    },
    limits: {
      linksPerMonth: 100,
      apiRequestsPerMonth: 0,
      webhooks: 0,
      customDomains: 0,
      bulkImportMax: 0,
      activeCampaigns: 0,
      teamSeats: 1,
      interstitialOnOwnedLinks: true,
      analyticsRetentionDays: 30,
    },
  },
  pro: {
    name: 'pro',
    capabilities: {
      customSlugs: true,
      password: true,
      expiry: true,
      qr: true,
      geoRouting: false,
      deviceRouting: false,
      abTesting: true,
    },
    limits: {
      linksPerMonth: null,
      apiRequestsPerMonth: 10_000,
      webhooks: 3,
      customDomains: 1,
      bulkImportMax: 1_000,
      activeCampaigns: 5,
      teamSeats: 1,
      interstitialOnOwnedLinks: false,
      analyticsRetentionDays: 1095,
    },
  },
  business: {
    name: 'business',
    capabilities: {
      customSlugs: true,
      password: true,
      expiry: true,
      qr: true,
      geoRouting: true,
      deviceRouting: true,
      abTesting: true,
    },
    limits: {
      linksPerMonth: null,
      apiRequestsPerMonth: 100_000,
      webhooks: 10,
      customDomains: 5,
      bulkImportMax: 50_000,
      activeCampaigns: null,
      teamSeats: 3,
      interstitialOnOwnedLinks: false,
      analyticsRetentionDays: 1095,
    },
  },
} as const;

/**
 * Capability lookup helper. Returns whether `plan` may use `feature`.
 * The richer `requireFeature(user, feature)` (throws / returns a plan-required
 * error) lives in `packages/billing` and builds on this.
 */
export function hasCapability(plan: PlanName, feature: Feature): boolean {
  return PLANS[plan].capabilities[feature];
}

// ---- Default prices ---------------------------------------------------------

export const currencies = ['NGN', 'USD'] as const;
export type Currency = (typeof currencies)[number];

export const intervals = ['monthly', 'yearly'] as const;
export type Interval = (typeof intervals)[number];

/**
 * Default plan prices, in MINOR units (kobo for NGN, cents for USD), per
 * (plan, currency, interval). Source: §3.
 *
 * ADMIN OVERRIDE: the DB `plan_prices` table overrides these per row; treat
 * `DEFAULT_PRICES` as the seed/fallback when no override exists. Free is always
 * 0 in every currency/interval.
 */
export const DEFAULT_PRICES: Readonly<
  Record<PlanName, Record<Currency, Record<Interval, number>>>
> = {
  free: {
    NGN: { monthly: 0, yearly: 0 },
    USD: { monthly: 0, yearly: 0 },
  },
  pro: {
    // ₦2,500/mo, ₦25,000/yr
    NGN: { monthly: 250_000, yearly: 2_500_000 },
    // $4.99/mo, $49/yr
    USD: { monthly: 499, yearly: 4_900 },
  },
  business: {
    // ₦9,000/mo, ₦90,000/yr
    NGN: { monthly: 900_000, yearly: 9_000_000 },
    // $19/mo, $190/yr
    USD: { monthly: 1_900, yearly: 19_000 },
  },
} as const;
