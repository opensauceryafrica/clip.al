import { redis } from '@clipal/cache';

/** Days a usage bucket lives past its month before Redis evicts it (~13 months). */
const USAGE_BUCKET_TTL_SECONDS = 60 * 60 * 24 * 400;

/**
 * UTC `YYYYMM` for a caller-supplied instant. Deterministic by design — the
 * timestamp is ALWAYS an argument so usage attribution is testable and never
 * depends on the module-load clock. Buckets are keyed in UTC to match the
 * billing period boundaries the rest of the system uses.
 */
export function usagePeriod(at: Date): string {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth() + 1;
  return `${y}${m < 10 ? '0' : ''}${m}`;
}

function usageKey(userId: string, at: Date): string {
  return `usage:links:${userId}:${usagePeriod(at)}`;
}

/**
 * Increments the link-creation counter for `userId` in the month of `at` and
 * returns the new total. Sets a long TTL on first write so stale buckets self
 * evict. Best-effort: if Redis is unreachable the call resolves to 0 rather
 * than throwing (link creation is enforced elsewhere; usage is advisory).
 */
export async function incrementLinkUsage(userId: string, at: Date, by = 1): Promise<number> {
  const key = usageKey(userId, at);
  try {
    const total = await redis.incrby(key, by);
    // First write in this bucket: stamp a TTL so it eventually expires.
    if (total === by) await redis.expire(key, USAGE_BUCKET_TTL_SECONDS);
    return total;
  } catch {
    return 0;
  }
}

/**
 * Reads the link-creation count for `userId` in the month of `at`. Returns 0
 * when the bucket is absent or Redis is unreachable; never throws.
 */
export async function getLinkUsage(userId: string, at: Date): Promise<number> {
  try {
    const v = await redis.get(usageKey(userId, at));
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
}
