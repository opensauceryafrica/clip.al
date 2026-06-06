export { isUnsafeHost } from './ssrf';
export {
  validateDestination,
  type SyntaxResult,
  type ValidatedUrl,
  type RejectReason,
} from './url';
export { scanUrl, scanUrls, isGsbConfigured, type SafetyState, type ScanResult } from './gsb';
export { registrableDomain } from './domain';
export { checkBrandTerms, matchBrandTerm, type BrandMatch, type BrandTermPolicy } from './brand';

// Domain blocklist + brand terms live in Redis (rebuilt from Postgres on change).
// Re-exported here so callers reach all URL-safety primitives from one package.
export { isBlockedDomain, loadBlockedDomains, loadBrandTerms, type BrandTerm } from '@clipal/cache';
