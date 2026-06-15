export { isUnsafeHost } from './ssrf';
export {
  validateDestination,
  type SyntaxResult,
  type ValidatedUrl,
  type RejectReason,
} from './url';
export { scanUrl, scanUrls, isGsbConfigured, type SafetyState, type ScanResult } from './gsb';
export { registrableDomain } from './domain';
export { containsProfanity } from './profanity';
export {
  checkBlocklist,
  matchKeyword,
  type BlockDecision,
  type KeywordMatch,
  type BlockPolicy,
} from './blocklist';

// The unified blocklist lives in Redis (rebuilt from Postgres on change).
// Re-exported here so callers reach all URL-safety primitives from one package.
export { loadBlocklist, type BlockEntry, type BlockMatch } from '@clipal/cache';
