/**
 * Bulk-seed African-market brand terms into flagged_brand_terms (§14.13).
 *
 * Idempotent: ON CONFLICT DO NOTHING, safe to re-run. Every term is policy 'flag'
 * and seed-owned (added_by null) — it never changes existing rows or their
 * policy. Rebuilds the Redis brand-terms cache afterwards so the safety pipeline
 * picks the new terms up immediately, no worker restart.
 *
 * Run: `pnpm seed:brand-terms`.
 */
import { loadBrandTerms, redis } from '@clipal/cache';
import { db, flaggedBrandTerms, recordAudit, sqlClient } from '@clipal/db';

const SOURCE = 'african-markets-v1';

// Distinctive African-market brand names (banks, fintech, pan-African telco/
// wallet, crypto, comms). Curated for substring matching against destination
// hostnames. A handful overlap with the existing seed set (binance, coinbase,
// metamask, whatsapp, discord) and are simply skipped on conflict.
const TERMS: readonly string[] = [
  // Nigerian banks
  'gtb', 'firstbank', 'accessbank', 'zenithbank', 'uba', 'fidelity',
  'polaris', 'wema', 'sterling', 'unionbank', 'stanbic', 'ecobank',
  // Nigerian fintech
  'flutterwave', 'paystack', 'opay', 'kuda', 'palmpay', 'chipper',
  'carbon', 'monnify', 'interswitch', 'quickteller',
  // Pan-African
  'mpesa', 'mtn', 'airtel', 'safaricom',
  // Crypto
  'binance', 'coinbase', 'kraken', 'metamask', 'trezor', 'ledger',
  // Comms
  'whatsapp', 'telegram', 'signal', 'discord', 'linkedin',
];

async function main(): Promise<void> {
  const rows = TERMS.map((term) => ({ term: term.toLowerCase(), policy: 'flag' as const }));

  // RETURNING with ON CONFLICT DO NOTHING yields ONLY the rows actually inserted,
  // so its length is the count of newly-added terms.
  const inserted = await db
    .insert(flaggedBrandTerms)
    .values(rows)
    .onConflictDoNothing({ target: flaggedBrandTerms.term })
    .returning({ term: flaggedBrandTerms.term });

  const newlyInserted = inserted.length;
  const alreadyPresent = rows.length - newlyInserted;

  // Rebuild the Redis brand-terms hash from the full table (same shape the boot
  // bootstrap and admin mutations use) so the check is live immediately.
  const all = await db
    .select({ term: flaggedBrandTerms.term, policy: flaggedBrandTerms.policy })
    .from(flaggedBrandTerms);
  await loadBrandTerms(all);

  // One summary audit entry — system action (actor null), only when something
  // actually changed so re-runs stay quiet.
  if (newlyInserted > 0) {
    await recordAudit(db, {
      actorId: null,
      action: 'brand_terms.bulk_seed',
      targetType: 'brand_term',
      targetId: SOURCE,
      metadata: { count: newlyInserted, source: SOURCE },
    });
  }

  console.log(
    `✓ brand-terms [${SOURCE}]: ${newlyInserted} newly inserted, ${alreadyPresent} already present ` +
      `(${rows.length} in set; ${all.length} total in table). Redis cache rebuilt.`,
  );
}

main()
  .then(async () => {
    await redis.quit();
    await sqlClient.end();
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('✗ seed-brand-terms failed:', err);
    process.exit(1);
  });
