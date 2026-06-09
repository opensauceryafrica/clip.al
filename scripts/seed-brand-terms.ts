/**
 * Bulk-seed African-market brand keywords into the unified blocklist (§14.13) as
 * 'keyword'/'flag' entries.
 *
 * Idempotent: ON CONFLICT DO NOTHING, safe to re-run. Every entry is policy 'flag'
 * and seed-owned (added_by null) — it never changes existing rows. Rebuilds the
 * Redis blocklist afterwards so the safety pipeline picks the new keywords up
 * immediately, no worker restart.
 *
 * Run: `pnpm seed:brand-terms`.
 */
import { loadBlocklist, redis } from '@clipal/cache';
import { blockedDomains, db, recordAudit, sqlClient } from '@clipal/db';

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
  const rows = TERMS.map((term) => ({
    domain: term.toLowerCase(),
    match: 'keyword' as const,
    policy: 'flag' as const,
    reason: 'brand',
  }));

  // RETURNING with ON CONFLICT DO NOTHING yields ONLY the rows actually inserted.
  const inserted = await db
    .insert(blockedDomains)
    .values(rows)
    .onConflictDoNothing({ target: blockedDomains.domain })
    .returning({ domain: blockedDomains.domain });

  const newlyInserted = inserted.length;
  const alreadyPresent = rows.length - newlyInserted;

  // Rebuild the Redis blocklist from the full table so the check is live now.
  const all = await db
    .select({ value: blockedDomains.domain, match: blockedDomains.match, policy: blockedDomains.policy })
    .from(blockedDomains);
  await loadBlocklist(all);

  // One summary audit entry — system action (actor null), only when something
  // actually changed so re-runs stay quiet.
  if (newlyInserted > 0) {
    await recordAudit(db, {
      actorId: null,
      action: 'blocklist.bulk_seed',
      targetType: 'blocklist',
      targetId: SOURCE,
      metadata: { count: newlyInserted, source: SOURCE, match: 'keyword' },
    });
  }

  console.log(
    `✓ blocklist keywords [${SOURCE}]: ${newlyInserted} newly inserted, ${alreadyPresent} already present ` +
      `(${rows.length} in set; ${all.length} total in blocklist). Redis cache rebuilt.`,
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
