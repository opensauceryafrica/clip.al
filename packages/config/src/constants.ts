/**
 * Shared, environment-independent constants. Safe to import anywhere (no
 * secrets, no Node-only APIs).
 */

// ---- Slugs ------------------------------------------------------------------

/** base62 alphabet for generated short codes. */
export const SLUG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Default generated slug length. 62^7 ≈ 3.5e12 address space. */
export const SLUG_LENGTH = 7;

/** Max retries when a generated slug collides on INSERT. */
export const SLUG_MAX_RETRIES = 3;

/**
 * Shape a redirect code must match before we even touch Redis/Postgres. Permissive
 * (letters, digits, hyphen, underscore; 4–32) so generated AND custom slugs both
 * resolve on /r. Set-time custom slugs are held to the stricter CUSTOM_SLUG_REGEX.
 */
export const CODE_REGEX = /^[A-Za-z0-9_-]{4,32}$/;

/** Bounds for a user-chosen custom back-half. */
export const CUSTOM_SLUG_MIN_LENGTH = 4;
export const CUSTOM_SLUG_MAX_LENGTH = 32;

/** How many old back-halves a link keeps redirecting (most recent kept). */
export const CUSTOM_SLUG_HISTORY_MAX = 5;

/**
 * What a user may set a custom back-half to (§ custom slugs). Letters, digits,
 * hyphen and underscore; must start and end alphanumeric (no leading/trailing or
 * lonely separators), 4–32 chars. Case is preserved and codes resolve
 * case-sensitively, same as generated slugs.
 */
export const CUSTOM_SLUG_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{2,30}[A-Za-z0-9]$/;

/** Hard cap on destination URL length (§14.1). */
export const MAX_DESTINATION_URL_LENGTH = 2048;

// ---- Auth -------------------------------------------------------------------

export const AUTH_CODE_LENGTH = 6;
export const AUTH_CODE_TTL_SECONDS = 10 * 60; // 10 minutes
export const AUTH_CODE_MAX_ATTEMPTS = 5; // per code
export const AUTH_VERIFY_LOCK_THRESHOLD = 10; // failed verifies / hour / email before lock
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const SESSION_COOKIE_NAME = 'clipal_session';
export const SESSION_LAST_SEEN_THROTTLE_SECONDS = 3600; // refresh last_seen_at at most hourly
export const USER_CACHE_TTL_SECONDS = 60;

// ---- Reserved slugs ---------------------------------------------------------
// TODO(@owner): confirm the final reserved set (see OPEN_QUESTIONS.md). Seeded
// from §7 plus route prefixes and obvious brand/handle squats.
export const RESERVED_SLUGS: readonly string[] = [
  // platform routes / prefixes
  'admin', 'api', 'r', 'p', 'dashboard', 'login', 'signin', 'signup', 'verify',
  'logout', 'settings', 'account', 'billing', 'pricing', 'help', 'support',
  'docs', 'doc', 'blog', 'tos', 'terms', 'privacy', 'aup', 'dmca', 'legal',
  'about', 'contact', 'status', 'changelog', 'links', 'link', 'analytics',
  'app', 'auth', 'static', 'assets', 'cdn', 'public', 'robots', 'sitemap',
  'favicon', 'manifest', 'health', 'ping', 'metrics', 'new', 'edit', 'report',
  // brand/handle squats
  'paypal', 'apple', 'google', 'microsoft', 'amazon', 'meta', 'facebook',
  'instagram', 'tiktok', 'twitter', 'x', 'youtube', 'whatsapp', 'telegram',
  'bitcoin', 'ethereum', 'binance', 'coinbase', 'metamask', 'netflix',
  'spotify', 'discord', 'slack', 'github', 'gitlab', 'linkedin', 'reddit',
  'clipal', 'clip',
];

// ---- Known URL shorteners (refuse to shorten these — §14.1) ----------------
// TODO(@owner): confirm list (see OPEN_QUESTIONS.md).
export const KNOWN_SHORTENERS: readonly string[] = [
  'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'rebrand.ly', 'cutt.ly', 't.ly', 'rb.gy', 'shorturl.at', 'tiny.cc',
  'bl.ink', 'short.io', 'lnkd.in', 'youtu.be', 'amzn.to', 'fb.me',
  'clip.al', // refuse clip.al -> clip.al loops
];

// ---- Brand terms (trademark protection — §14.13) ---------------------------
// Used as substring matches in a destination hostname to FLAG lookalikes for
// admin review (e.g. `paypal-login.com`) — NOT to hard-reject (that's what
// blocked_domains is for). Deliberately a curated set of *distinctive* brand
// names: generic words (account, secure, login, verify, bank) and short/
// ambiguous tokens (apple→"pineapple", amazon→"amazonaws", x) are excluded
// because substring matching would false-positive on legitimate hosts.
// TODO(@owner): confirm the canonical list + flag-vs-reject policy (OPEN_QUESTIONS).
export const BRAND_TERMS: readonly string[] = [
  'paypal', 'microsoft', 'netflix', 'instagram', 'whatsapp', 'facebook',
  'binance', 'coinbase', 'metamask', 'blockchain', 'revolut', 'santander',
  'barclays', 'wellsfargo', 'roblox', 'discord', 'steamcommunity', 'coinbasepro',
];

// ---- Default profanity terms (soft slug check — §8) ------------------------
// Substring-matched (case-insensitive) against a user-chosen custom slug to
// SOFT-reject obviously offensive back-halves. Deliberately small and
// conservative — admin can extend/override via the `app_settings`
// `profanity_wordlist` key (DB overrides this default).
// TODO(@owner): refine this baseline wordlist with the moderation policy.
export const DEFAULT_PROFANITY_TERMS: readonly string[] = [
  'fuck', 'shit', 'cunt', 'bitch', 'bastard', 'asshole', 'dick', 'pussy',
  'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'rape', 'molest',
  'pedo', 'paedo', 'kkk', 'nazi',
];

// ---- Default restricted countries (billing — §14.6) ------------------------
// ISO-3166 alpha-2 codes for countries where subscription creation is blocked
// because neither Paystack (NGN) nor Polar (USD) can be served there
// (sanctioned / unsupported). Admin can extend/override via the `app_settings`
// `restricted_countries` key (DB overrides this default).
// TODO(@owner): reconcile with the current Paystack/Polar supported-country
// lists and the prevailing sanctions program before launch.
export const DEFAULT_RESTRICTED_COUNTRIES: readonly string[] = [
  'CU', // Cuba
  'IR', // Iran
  'KP', // North Korea
  'SY', // Syria
  'RU', // Russia
  'BY', // Belarus
  'AF', // Afghanistan
  'SD', // Sudan
  'SS', // South Sudan
  'VE', // Venezuela
  'MM', // Myanmar
];

// ---- Device classes ---------------------------------------------------------
export const DEVICE_CLASSES = ['mobile', 'tablet', 'desktop', 'bot', 'unknown'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

// ---- Interstitial -----------------------------------------------------------
export const INTERSTITIAL_COUNTDOWN_SECONDS = 5;
/** report_count threshold that auto-moves a link to pending_review (§15). */
export const REPORT_AUTO_REVIEW_THRESHOLD = 5;
