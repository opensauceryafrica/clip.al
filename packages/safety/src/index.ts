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

// Ad bot-defense primitives (spec §14.7): UA classification + datacenter-IP
// matching, consumed by the web ad gate (apps/web/lib/ads.ts).
export { userAgentLooksBot } from './bot-ua';
export { isDatacenterIp } from './asn-denylist';

// The unified blocklist lives in Redis (rebuilt from Postgres on change).
// Re-exported here so callers reach all URL-safety primitives from one package.
export { loadBlocklist, type BlockEntry, type BlockMatch } from '@clipal/cache';
