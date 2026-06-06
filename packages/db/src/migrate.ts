import { fileURLToPath } from 'node:url';
import { env } from '@clipal/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Applies all Drizzle migrations. Run via `pnpm --filter @clipal/db migrate`
 * (or `make migrate`). Idempotent — already-applied migrations are skipped.
 *
 * citext must exist before the table migrations (which reference the type), and
 * extensions are not part of the Drizzle schema, so we create it here first.
 * gen_random_uuid() is core in Postgres 16, so no pgcrypto extension is needed.
 */
async function main(): Promise<void> {
  const client = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await client`CREATE EXTENSION IF NOT EXISTS citext;`;
    const db = drizzle(client);
    const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
    await migrate(db, { migrationsFolder });
    console.log('✓ migrations applied');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('✗ migration failed:', err);
  process.exit(1);
});
