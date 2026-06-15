/**
 * Cookie-consent state — the read/parse layer of clip.al's self-rolled CMP
 * (spec §10 compliance + §14.5). One canonical `clipal_consent` cookie carries
 * the visitor's advertising choice; this module is the single source of truth
 * for how it is named, shaped and interpreted.
 *
 * Design / compliance notes
 * -------------------------
 * - ESSENTIAL cookies (session, CSRF, A/B) are always allowed and are NOT gated
 *   by this consent — only ADVERTISING is optional.
 * - The cookie stores `{ ads: boolean, ts: number }` as JSON. `ads` is the
 *   opt-in/opt-out for ad scripts; `ts` is the epoch-ms the choice was made
 *   (so we can age-out / re-prompt if the policy ever changes).
 * - This file is import-safe from BOTH server and client:
 *     · server components / route handlers pass the Next `cookies()` store (or a
 *       Map<string,string> from `parseCookies`) into {@link getConsent};
 *     · the client banner uses {@link CONSENT_COOKIE} + {@link encodeConsent} to
 *       read/write `document.cookie` directly (no server round-trip required).
 *   It deliberately does NOT import `next/headers` so it stays usable in client
 *   bundles; callers supply the cookie source.
 *
 * - AD-SCRIPT GATING (the important bit): ad scripts (AdSense, our interstitial
 *   AdSlot) MUST NOT load before consent. The interstitial server component is
 *   expected to call {@link hasAdsConsent} with the request's consent cookie AND
 *   the visitor's country, and only render the AdSlot when it returns true.
 *
 *   · EU / UK / CA visitors (GDPR / UK-GDPR / Quebec Law 25 etc.) require an
 *     EXPLICIT opt-in: with no decision recorded, {@link hasAdsConsent} returns
 *     false (ads off) for them. The banner therefore defaults to "no ads" until
 *     they press Accept.
 *   · Elsewhere a lighter notice is acceptable: we still record the choice, but
 *     a not-yet-decided visitor MAY see ads. That permissive default is what the
 *     `country` argument toggles — see {@link hasAdsConsent}.
 */

/** Name of the consent cookie. Shared verbatim by server reads and client writes. */
export const CONSENT_COOKIE = 'clipal_consent';

/** Consent cookie lifetime — 1 year (in seconds), matching the banner's promise. */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * ISO-3166-1 alpha-2 countries (plus the UK) that require EXPLICIT ad opt-in.
 * EU/EEA + UK + Canada (covers GDPR, UK-GDPR, Quebec Law 25 / PIPEDA). For these
 * regions the absence of a recorded choice means NO ads. Kept here so the gate
 * and the banner agree on who gets the strict default.
 */
const EXPLICIT_OPT_IN_COUNTRIES = new Set<string>([
  // EU / EEA
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'IS', 'LI', 'NO',
  // United Kingdom
  'GB', 'UK',
  // Canada
  'CA',
]);

/** Parsed consent state. `ads` is the advertising opt-in; `ts` is epoch-ms or null. */
export interface Consent {
  /** Whether the visitor opted in to advertising cookies/scripts. */
  ads: boolean;
  /** Epoch-ms the choice was recorded, or null when no choice exists yet. */
  ts: number | null;
}

/**
 * A cookie source this module can read from. Covers:
 *  - the Next `cookies()` store (`{ get(name) -> { value } | undefined }`),
 *  - a `Map<string,string>` from `apps/web/lib/request.parseCookies`,
 *  - a plain Cookie-header string.
 */
export type CookieSource =
  | { get(name: string): { value: string } | undefined }
  | Map<string, string>
  | string;

/** True when this country demands an explicit ad opt-in (no implied consent). */
export function requiresExplicitConsent(country: string | null | undefined): boolean {
  if (!country) return false;
  return EXPLICIT_OPT_IN_COUNTRIES.has(country.trim().toUpperCase());
}

/** Pull a raw cookie value out of any supported {@link CookieSource}. */
function readRaw(source: CookieSource, name: string): string | undefined {
  if (typeof source === 'string') {
    for (const part of source.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === name) {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
    return undefined;
  }
  if (source instanceof Map) return source.get(name);
  return source.get(name)?.value;
}

/**
 * Parse the recorded consent. Returns `{ ads: false, ts: null }` when no cookie
 * is present or the value is malformed (fail CLOSED — never assume opt-in). A
 * `ts: null` result signals "no decision yet", which {@link hasAdsConsent} uses
 * together with the country to pick the default.
 */
export function getConsent(source: CookieSource): Consent {
  const raw = readRaw(source, CONSENT_COOKIE);
  if (!raw) return { ads: false, ts: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'ads' in parsed &&
      typeof (parsed as { ads: unknown }).ads === 'boolean'
    ) {
      const ads = (parsed as { ads: boolean }).ads;
      const tsVal = (parsed as { ts?: unknown }).ts;
      const ts = typeof tsVal === 'number' && Number.isFinite(tsVal) ? tsVal : null;
      return { ads, ts };
    }
  } catch {
    // malformed → treat as no decision
  }
  return { ads: false, ts: null };
}

/** True once the visitor has recorded ANY choice (the banner should stay hidden). */
export function hasDecided(source: CookieSource): boolean {
  return getConsent(source).ts !== null;
}

/**
 * THE AD GATE. Returns whether ad scripts may load for this request.
 *
 * @param source   the request's cookie source (Next store / Map / header string)
 * @param country  ISO-2 country from `@clipal/geo` lookupCountry(getClientIp(...))
 *
 * Rules:
 *  - An explicit recorded choice always wins (opt-in → true, opt-out → false).
 *  - With NO recorded choice:
 *      · EU/UK/CA (see {@link requiresExplicitConsent}) → false (strict default,
 *        ads stay off until the visitor accepts).
 *      · everywhere else → true (lighter-notice regime; ads may show while the
 *        banner still records the choice).
 *
 * The interstitial AdSlot must call this and skip rendering when it is false.
 */
export function hasAdsConsent(source: CookieSource, country: string | null | undefined): boolean {
  const { ads, ts } = getConsent(source);
  if (ts !== null) return ads; // explicit decision recorded
  // No decision yet: strict regions default to off, everyone else defaults to on.
  return !requiresExplicitConsent(country);
}

/**
 * Serialise a fresh choice for storage. Stamps `ts` with the current time so the
 * decision is dated. Both the `/api/consent` route and the client banner use
 * this so the cookie shape never diverges.
 */
export function encodeConsent(ads: boolean, now: number = Date.now()): string {
  const value: Consent = { ads, ts: now };
  return JSON.stringify(value);
}
