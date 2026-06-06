import { BRAND_TERMS, KNOWN_SHORTENERS, MAX_DESTINATION_URL_LENGTH } from '@clipal/config/constants';
import { parse as parseDomain } from 'tldts';
import { isUnsafeHost } from './ssrf';

export type RejectReason =
  | 'empty'
  | 'too_long'
  | 'invalid'
  | 'bad_scheme'
  | 'has_credentials'
  | 'private_host'
  | 'known_shortener';

export interface ValidatedUrl {
  /** Normalized absolute URL (href). */
  url: string;
  /** Lowercased hostname. */
  host: string;
  /** Registrable domain (eTLD+1), used for blocklist lookups. */
  etld1: string;
}

export type SyntaxResult =
  | { ok: true; value: ValidatedUrl; brandFlag: boolean }
  | { ok: false; reason: RejectReason; message: string };

function fail(reason: RejectReason, message: string): SyntaxResult {
  return { ok: false, reason, message };
}

/**
 * Synchronous submission-time validation (§14.1). Does everything that doesn't
 * need a network/Redis round-trip:
 *  - length ≤ 2048, parseable, http/https only, no embedded credentials
 *  - reject IP literals / localhost / private / internal hosts (SSRF)
 *  - reject other known shorteners (no shortener-of-shortener loops)
 *  - compute a soft `brandFlag` for trademark lookalikes (e.g. paypal-login.com)
 *
 * The blocklist (Redis) and Google Safe Browsing checks are async — see
 * `isDomainBlocked` and `scanUrl`.
 */
export function validateDestination(raw: string): SyntaxResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fail('empty', 'Enter a URL to shorten.');
  if (trimmed.length > MAX_DESTINATION_URL_LENGTH) {
    return fail('too_long', `URLs must be ${MAX_DESTINATION_URL_LENGTH} characters or fewer.`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return fail('invalid', 'That doesn’t look like a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail('bad_scheme', 'Only http and https links can be shortened.');
  }
  if (url.username !== '' || url.password !== '') {
    return fail('has_credentials', 'URLs with embedded credentials aren’t allowed.');
  }

  const host = url.hostname.toLowerCase();
  if (isUnsafeHost(host)) {
    return fail('private_host', 'That destination points to a private or internal address.');
  }

  const parsed = parseDomain(host);
  const etld1 = parsed.domain ?? host;
  const sld = parsed.domainWithoutSuffix ?? '';

  if (KNOWN_SHORTENERS.includes(etld1)) {
    return fail(
      'known_shortener',
      'That’s already a shortened link — point clip.al at the final destination instead.',
    );
  }

  // Trademark lookalike heuristic: a brand term appears in the host but the
  // registrable domain's SLD isn't exactly that brand (so it's not the genuine
  // brand domain). Soft flag → the link is created as pending_review, not
  // hard-rejected, to limit false positives. (Policy: TODO(@owner), §14.13.)
  const brandFlag = BRAND_TERMS.some((term) => host.includes(term) && sld !== term);

  return { ok: true, value: { url: url.href, host, etld1 }, brandFlag };
}
