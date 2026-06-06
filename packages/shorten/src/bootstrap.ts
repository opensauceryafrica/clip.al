import { loadBlockedDomains, loadBrandTerms, loadReservedSlugs } from '@clipal/cache';
import { BRAND_TERMS, RESERVED_SLUGS } from '@clipal/config/constants';
import { blockedDomains, db, flaggedBrandTerms } from '@clipal/db';

/**
 * Load the O(1) membership structures into Redis at boot (§14.12, §14.1,
 * §14.13): reserved slugs from config, blocked domains + brand terms from
 * Postgres. Call once on server start (web instrumentation). Admin mutations
 * rebuild the relevant Redis structure too.
 */
export async function bootstrapSecuritySets(): Promise<void> {
  await loadReservedSlugs(RESERVED_SLUGS);

  const rows = await db.select({ domain: blockedDomains.domain }).from(blockedDomains);
  await loadBlockedDomains(rows.map((r) => r.domain));

  await bootstrapBrandTerms();
}

/**
 * Seed flagged_brand_terms from the config BRAND_TERMS constant on FIRST boot
 * only (when the table is empty), then cache the table contents in Redis. After
 * the seed, admins own the list via /admin/brand-terms — code changes to
 * BRAND_TERMS no longer affect a deployed database.
 */
async function bootstrapBrandTerms(): Promise<void> {
  const existing = await db.select({ term: flaggedBrandTerms.term }).from(flaggedBrandTerms);

  if (existing.length === 0 && BRAND_TERMS.length > 0) {
    await db
      .insert(flaggedBrandTerms)
      .values(BRAND_TERMS.map((term) => ({ term: term.toLowerCase(), policy: 'flag' as const })))
      .onConflictDoNothing({ target: flaggedBrandTerms.term });
  }

  const all = await db
    .select({ term: flaggedBrandTerms.term, policy: flaggedBrandTerms.policy })
    .from(flaggedBrandTerms);
  await loadBrandTerms(all);
}
