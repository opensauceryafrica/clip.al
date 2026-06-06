/**
 * Create (or promote) the initial admin user from INITIAL_ADMIN_EMAIL.
 * Idempotent. Run: `pnpm seed:admin` (or `make seed`).
 */
import { env } from '@clipal/config';
import { db, eq, sqlClient, users } from '@clipal/db';

async function main(): Promise<void> {
  const email = env.INITIAL_ADMIN_EMAIL;
  if (!email) {
    console.error('Set INITIAL_ADMIN_EMAIL in your environment first.');
    process.exit(1);
  }

  const [existing] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    if (existing.role === 'admin') {
      console.log(`✓ ${email} is already an admin.`);
    } else {
      await db.update(users).set({ role: 'admin', status: 'active' }).where(eq(users.id, existing.id));
      console.log(`✓ Promoted ${email} to admin.`);
    }
  } else {
    await db.insert(users).values({ email, role: 'admin', displayName: env.INITIAL_ADMIN_NAME });
    console.log(`✓ Created admin ${email}. Sign in at /signin to receive a code.`);
  }
}

main()
  .then(() => sqlClient.end())
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('✗ seed-admin failed:', err);
    process.exit(1);
  });
