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

// ---- Blocklist (unified: domains + keywords) --------------------------------

export type BlockPolicy = 'flag' | 'reject';
export type BlockMatch = 'domain' | 'keyword';

export interface BlockEntry {
  value: string;
  match: BlockMatch;
  policy: BlockPolicy;
}

function asPolicy(v: string | null | undefined): BlockPolicy | null {
  return v === 'reject' ? 'reject' : v === 'flag' ? 'flag' : null;
}

/**
 * Rebuild the blocklist from Postgres (boot + on admin mutation). Stored as two
 * hashes — value→policy — for the two lookup shapes: exact eTLD+1 (domains) and
 * substring-of-host (keywords).
 */
export async function loadBlocklist(entries: readonly BlockEntry[]): Promise<void> {
  const domains: Record<string, string> = {};
  const keywords: Record<string, string> = {};
  for (const e of entries) {
    (e.match === 'keyword' ? keywords : domains)[e.value.toLowerCase()] = e.policy;
  }
  const pipeline = redis.pipeline();
  pipeline.del(keys.blocklistDomains);
  pipeline.del(keys.blocklistKeywords);
  if (Object.keys(domains).length > 0) pipeline.hset(keys.blocklistDomains, domains);
  if (Object.keys(keywords).length > 0) pipeline.hset(keys.blocklistKeywords, keywords);
  await pipeline.exec();
}

/** Exact eTLD+1 lookup → its block policy, or null if the domain isn't listed. */
export async function blockedDomainPolicy(domain: string): Promise<BlockPolicy | null> {
  return asPolicy(await redis.hget(keys.blocklistDomains, domain.toLowerCase()));
}

/** All keyword entries, for the substring matcher on the shorten path. */
export async function getBlockKeywords(): Promise<BlockEntry[]> {
  const raw = await redis.hgetall(keys.blocklistKeywords);
  return Object.entries(raw).map(([value, policy]) => ({
    value,
    match: 'keyword',
    policy: asPolicy(policy) ?? 'flag',
  }));
}

export async function addBlockEntry(
  value: string,
  match: BlockMatch,
  policy: BlockPolicy,
): Promise<void> {
  const key = match === 'keyword' ? keys.blocklistKeywords : keys.blocklistDomains;
  await redis.hset(key, value.toLowerCase(), policy);
}

export async function removeBlockEntry(value: string, match: BlockMatch): Promise<void> {
  const key = match === 'keyword' ? keys.blocklistKeywords : keys.blocklistDomains;
  await redis.hdel(key, value.toLowerCase());
}
