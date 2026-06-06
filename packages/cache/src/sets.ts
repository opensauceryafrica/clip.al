import { redis } from './client';
import { keys } from './keys';

/**
 * O(1) membership sets kept in Redis for the shorten hot path: reserved slugs
 * and blocked domains. Rebuilt from Postgres at boot and whenever an admin
 * mutates the source (§14.1, §14.12).
 */

async function rebuildSet(key: string, members: readonly string[]): Promise<void> {
  const pipeline = redis.pipeline();
  pipeline.del(key);
  if (members.length > 0) {
    pipeline.sadd(key, ...members.map((m) => m.toLowerCase()));
  }
  await pipeline.exec();
}

// ---- Reserved slugs ---------------------------------------------------------

export function loadReservedSlugs(slugs: readonly string[]): Promise<void> {
  return rebuildSet(keys.reservedSlugs, slugs);
}

export async function isReservedSlug(slug: string): Promise<boolean> {
  return (await redis.sismember(keys.reservedSlugs, slug.toLowerCase())) === 1;
}

export async function addReservedSlug(slug: string): Promise<void> {
  await redis.sadd(keys.reservedSlugs, slug.toLowerCase());
}

// ---- Blocked domains --------------------------------------------------------

export function loadBlockedDomains(domains: readonly string[]): Promise<void> {
  return rebuildSet(keys.blockedDomains, domains);
}

export async function isBlockedDomain(domain: string): Promise<boolean> {
  return (await redis.sismember(keys.blockedDomains, domain.toLowerCase())) === 1;
}

export async function addBlockedDomain(domain: string): Promise<void> {
  await redis.sadd(keys.blockedDomains, domain.toLowerCase());
}

export async function removeBlockedDomain(domain: string): Promise<void> {
  await redis.srem(keys.blockedDomains, domain.toLowerCase());
}
