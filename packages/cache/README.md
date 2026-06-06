# @clipal/cache

Redis 7 access layer. Owns the connection (`redis`, plus `createRedis()` for
dedicated blocking-stream connections), the single source of truth for key names
(`keys`), the atomic sliding-window rate limiter (`rateLimit` / `rateLimitMany`,
§14.2), and the O(1) membership sets for reserved slugs and blocked domains
(§14.1, §14.12). Redis here also backs the hot-link cache, the click stream, and
the session revocation denylist.
