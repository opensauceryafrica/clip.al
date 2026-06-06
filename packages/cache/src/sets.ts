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

// ---- Brand / trademark terms ------------------------------------------------

export type BrandTermPolicy = 'flag' | 'reject';

export interface BrandTerm {
  term: string;
  policy: BrandTermPolicy;
}

/** Rebuild the brand-terms hash from Postgres (boot + on admin mutation). */
export async function loadBrandTerms(terms: readonly BrandTerm[]): Promise<void> {
  const pipeline = redis.pipeline();
  pipeline.del(keys.brandTerms);
  if (terms.length > 0) {
    const obj: Record<string, string> = {};
    for (const { term, policy } of terms) obj[term.toLowerCase()] = policy;
    pipeline.hset(keys.brandTerms, obj);
  }
  await pipeline.exec();
}

/** Read all cached brand terms. Used by the substring brand check on shorten. */
export async function getBrandTerms(): Promise<BrandTerm[]> {
  const raw = await redis.hgetall(keys.brandTerms);
  return Object.entries(raw).map(([term, policy]) => ({
    term,
    policy: policy === 'reject' ? 'reject' : 'flag',
  }));
}

export async function addBrandTerm(term: string, policy: BrandTermPolicy): Promise<void> {
  await redis.hset(keys.brandTerms, term.toLowerCase(), policy);
}

export async function removeBrandTerm(term: string): Promise<void> {
  await redis.hdel(keys.brandTerms, term.toLowerCase());
}
