import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['user', 'moderator', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'suspended', 'deleted']);

export const authPurpose = pgEnum('auth_purpose', ['signin', 'signup']);

export const linkStatus = pgEnum('link_status', [
  'active',
  'disabled_by_user',
  'disabled_by_admin',
  'disabled_by_safety',
  'pending_review',
]);

export const safetyState = pgEnum('safety_state', [
  'unchecked',
  'clean',
  'suspicious',
  'malicious',
]);

export const reportReason = pgEnum('report_reason', [
  'phishing',
  'malware',
  'spam',
  'nsfw',
  'illegal',
  'other',
]);

export const brandTermPolicy = pgEnum('brand_term_policy', ['flag', 'reject']);

/** How a blocklist entry matches a destination: exact eTLD+1, or substring of host. */
export const blockMatch = pgEnum('block_match', ['domain', 'keyword']);

// ── Phase 2: billing, plans & power features ──────────────────────────────────

export const planName = pgEnum('plan_name', ['free', 'pro', 'business']);
export const subInterval = pgEnum('sub_interval', ['monthly', 'yearly']);
export const subStatus = pgEnum('sub_status', ['active', 'past_due', 'cancelled', 'expired']);
export const currency = pgEnum('currency', ['NGN', 'USD']);
export const invoiceStatus = pgEnum('invoice_status', ['pending', 'paid', 'failed', 'refunded']);

/** Dual-billing: NGN flows through Paystack, USD through Polar.sh. */
export const billingProcessor = pgEnum('billing_processor', ['paystack', 'polar']);

/** Power-link redirect strategy. `single` = one destination; the rest fan out to link_destinations. */
export const routingMode = pgEnum('routing_mode', ['single', 'geo', 'device', 'ab']);

export const customDomainStatus = pgEnum('custom_domain_status', [
  'pending_dns',
  'pending_tls',
  'active',
  'error',
]);

export const adSlot = pgEnum('ad_slot', [
  'interstitial_top',
  'interstitial_bottom',
  'tree_top',
]);
