import { loadBlocklist, loadReservedSlugs } from '@clipal/cache';
import { BRAND_TERMS, RESERVED_SLUGS } from '@clipal/config/constants';
import { blockedDomains, db, eq } from '@clipal/db';

/**
 * Load the security structures into Redis at boot (§14.12, §14.1, §14.13):
 * reserved slugs from config, and the unified blocklist (domains + keywords) from
 * Postgres. Call once on server start (web instrumentation). Admin mutations
 * rebuild the relevant Redis structure too.
 */
export async function bootstrapSecuritySets(): Promise<void> {
  await loadReservedSlugs(RESERVED_SLUGS);
  await seedBrandKeywords();

  const rows = await db
    .select({ value: blockedDomains.domain, match: blockedDomains.match, policy: blockedDomains.policy })
    .from(blockedDomains);
  await loadBlocklist(rows);
}

/**
 * On FIRST boot only (no keyword entries yet), seed the config BRAND_TERMS into
 * the blocklist as 'keyword'/'flag' entries. After that admins own the list via
 * /admin/blocklist — code changes to BRAND_TERMS no longer affect a deployed DB.
 */
async function seedBrandKeywords(): Promise<void> {
  if (BRAND_TERMS.length === 0) return;
  const existing = await db
    .select({ id: blockedDomains.id })
    .from(blockedDomains)
    .where(eq(blockedDomains.match, 'keyword'))
    .limit(1);
  if (existing.length > 0) return;

  await db
    .insert(blockedDomains)
    .values(
      BRAND_TERMS.map((term) => ({
        domain: term.toLowerCase(),
        match: 'keyword' as const,
        policy: 'flag' as const,
        reason: 'brand',
      })),
    )
    .onConflictDoNothing({ target: blockedDomains.domain });
}
