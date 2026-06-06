import { createHash, randomBytes } from 'node:crypto';
import { keys, redis } from '@clipal/cache';

/** UTC YYYYMMDD key for the current day (or a given date). */
export function utcDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

const SALT_TTL_SECONDS = 60 * 60 * 48; // 48h so yesterday's salt survives for late events

/**
 * Today's IP-hashing salt. Stored in Redis (NX, 48h TTL) so all workers and a
 * restarted worker agree on the same salt and yesterday's still resolves. The
 * salt rotates at UTC midnight, making ip_hash useful for same-day dedupe but
 * unlinkable across days (§10, §14.10).
 */
export async function getDailySalt(date = new Date()): Promise<string> {
  const key = keys.dailySalt(utcDateKey(date));
  const existing = await redis.get(key);
  if (existing) return existing;

  const salt = randomBytes(16).toString('hex');
  const set = await redis.set(key, salt, 'EX', SALT_TTL_SECONDS, 'NX');
  if (set === 'OK') return salt;
  // Lost the race — another worker set it first.
  return (await redis.get(key)) ?? salt;
}

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${ip}${salt}`).digest('hex');
}
