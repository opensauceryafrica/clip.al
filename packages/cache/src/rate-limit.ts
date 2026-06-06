import { redis } from './client';
import { keys } from './keys';

/**
 * Sliding-window-log rate limiter. Each hit records a timestamp in a sorted set;
 * stale entries are trimmed and the live count is compared to the limit — all in
 * one atomic Lua script so concurrent requests can't race past the limit.
 *
 * Returns whether the hit is allowed and how many remain in the window.
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1}
end
redis.call('PEXPIRE', key, window)
return {0, 0}
`;

// Register as a custom command so ioredis uses EVALSHA (script cached server-side).
redis.defineCommand('clipalRateLimit', { numberOfKeys: 1, lua: SLIDING_WINDOW_LUA });

type RateLimitCommand = (
  key: string,
  now: string,
  windowMs: string,
  limit: string,
  member: string,
) => Promise<[number, number]>;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  limit: number;
}

/**
 * @param key       fully-qualified bucket key (use `keys.rateLimit(bucket, id)`)
 * @param limit     max hits allowed within the window
 * @param windowSec window length in seconds
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const member = `${now}:${Math.random().toString(36).slice(2)}`;
  // Call the custom command AS A METHOD on the redis client. Detaching it into a
  // local (`const run = redis.clipalRateLimit; run(...)`) loses the `this`
  // binding, so ioredis's generated command reads `this.options` on `undefined`
  // → "Cannot read properties of undefined (reading 'options')".
  const client = redis as unknown as { clipalRateLimit: RateLimitCommand };
  const [allowed, remaining] = await client.clipalRateLimit(
    key,
    String(now),
    String(windowSec * 1000),
    String(limit),
    member,
  );
  return { ok: allowed === 1, remaining, limit };
}

export interface Window {
  limit: number;
  windowSec: number;
}

/**
 * Enforce several windows at once (e.g. per-hour AND per-day for shortening).
 * Denies if ANY window is exceeded; reports the tightest remaining count.
 */
export async function rateLimitMany(
  bucket: string,
  id: string,
  windows: readonly Window[],
): Promise<RateLimitResult> {
  const results = await Promise.all(
    windows.map((w) => rateLimit(keys.rateLimit(`${bucket}:${w.windowSec}`, id), w.limit, w.windowSec)),
  );
  const blocked = results.find((r) => !r.ok);
  if (blocked) return blocked;
  const tightest = results.reduce((a, b) => (a.remaining <= b.remaining ? a : b));
  return tightest;
}
