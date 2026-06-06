/**
 * One-shot importer: load legacy abbrefy USERS (emails only) into the
 * `abbrefy_migrations` table so returning users are recognized at /signin (§11).
 * Idempotent — re-running skips already-imported emails.
 *
 * Run: `pnpm migrate:abbrefy` (or `make import-abbrefy`). Reads the JSON file at
 * ABBREFY_EXPORT_PATH.
 *
 * TODO(@owner): we defensively accept several field spellings. If the real export
 * differs, share a sample and we'll adjust the normalizer. See OPEN_QUESTIONS.md.
 */
import { readFileSync } from 'node:fs';
import { env } from '@clipal/config';
import { abbrefyMigrations, db, sqlClient } from '@clipal/db';

interface RawRecord {
  email?: unknown;
  legacy_id?: unknown;
  legacyId?: unknown;
  _id?: unknown;
  id?: unknown;
}

function normalize(rec: RawRecord): { email: string; legacyId: string } | null {
  const email = typeof rec.email === 'string' ? rec.email.trim().toLowerCase() : '';
  const legacyRaw = rec.legacy_id ?? rec.legacyId ?? rec._id ?? rec.id;
  const legacyId = legacyRaw == null ? '' : String(legacyRaw);
  if (!email || !email.includes('@') || !legacyId) return null;
  return { email, legacyId };
}

async function main(): Promise<void> {
  const path = env.ABBREFY_EXPORT_PATH;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const records: RawRecord[] = Array.isArray(parsed)
    ? (parsed as RawRecord[])
    : (((parsed as { users?: RawRecord[]; records?: RawRecord[] }).users ??
        (parsed as { records?: RawRecord[] }).records ??
        []) as RawRecord[]);

  let imported = 0;
  let skipped = 0;
  for (const raw of records) {
    const rec = normalize(raw);
    if (!rec) {
      skipped++;
      continue;
    }
    const result = await db
      .insert(abbrefyMigrations)
      .values({ email: rec.email, legacyId: rec.legacyId })
      .onConflictDoNothing({ target: abbrefyMigrations.email })
      .returning({ email: abbrefyMigrations.email });
    if (result.length > 0) imported++;
    else skipped++;
  }

  console.log(`✓ abbrefy import: ${imported} imported, ${skipped} skipped (of ${records.length}).`);
}

main()
  .then(() => sqlClient.end())
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('✗ abbrefy import failed:', err);
    process.exit(1);
  });
