import { loadBlockedDomains, loadReservedSlugs } from '@clipal/cache';
import { RESERVED_SLUGS } from '@clipal/config/constants';
import { blockedDomains, db } from '@clipal/db';

/**
 * Load the O(1) membership sets into Redis at boot (§14.12, §14.1): reserved
 * slugs from config, blocked domains from Postgres. Call once on server start
 * (web instrumentation). Admin mutations to the blocklist rebuild the set too.
 */
export async function bootstrapSecuritySets(): Promise<void> {
  await loadReservedSlugs(RESERVED_SLUGS);
  const rows = await db.select({ domain: blockedDomains.domain }).from(blockedDomains);
  await loadBlockedDomains(rows.map((r) => r.domain));
}
