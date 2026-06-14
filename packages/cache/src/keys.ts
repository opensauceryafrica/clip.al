/**
 * Centralized Redis key conventions. Every key the system uses is named here so
 * collisions are impossible and a `redis-cli --scan` is legible.
 */
export const keys = {
  /** Hot link cache: JSON {url, interstitial, safety} or the string "DISABLED". */
  hotLink: (code: string) => `link:hot:${code}`,

  /** Session revocation denylist (set on logout/suspension). Existence = revoked. */
  sessionRevoked: (sid: string) => `session:revoked:${sid}`,
  /** Throttle for sessions.last_seen_at writes (≤ hourly). */
  sessionLastSeen: (sid: string) => `session:lastseen:${sid}`,

  /** Short-TTL cached user record for request hydration. */
  userCache: (userId: string) => `user:${userId}`,

  /** The click event stream (XADD/XREADGROUP). */
  clickStream: 'clicks',
  /** Dead-letter stream for clicks that fail to ingest 3× (§10). */
  clickDlq: 'clicks:dlq',
  /** Per-day per-code rough counter (HINCRBY), flushed to Postgres by the worker. */
  clickCounter: (yyyymmdd: string) => `clicks:counter:${yyyymmdd}`,
  /** Authoritative click-limit counter for capped links (§8); INCR-if-below via Lua. */
  clickLimit: (code: string) => `clicks:limit:${code}`,

  /** Daily salt for IP hashing; rotates at UTC midnight, 48h TTL (§10). */
  dailySalt: (yyyymmdd: string) => `ip:salt:${yyyymmdd}`,

  /** Reserved slugs set (loaded at boot, §14.12). */
  reservedSlugs: 'set:reserved_slugs',
  /**
   * Unified blocklist (§14.1, §14.13), value → policy ('flag'|'reject'), split by
   * match shape: `domains` = exact eTLD+1 lookup, `keywords` = substring-of-host.
   * Rebuilt from Postgres at boot and on every admin mutation.
   */
  blocklistDomains: 'blocklist:domains',
  blocklistKeywords: 'blocklist:keywords',

  /** Sliding-window rate-limit bucket. */
  rateLimit: (bucket: string, id: string) => `rl:${bucket}:${id}`,
  /** Verify-attempt lock counter per email (§8 hardening). */
  verifyAttempts: (email: string) => `auth:verify:${email}`,
} as const;
