import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext } from './columns';
import { users } from './users';

/**
 * Records emails imported from the legacy abbrefy MongoDB. Used at /signin to
 * deflect a "new" email into a sign-in (claiming the migrated identity) rather
 * than a cold signup (§11). Links are NOT migrated — users only.
 */
export const abbrefyMigrations = pgTable('abbrefy_migrations', {
  email: citext('email').primaryKey(),
  legacyId: text('legacy_id').notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  claimedByUserId: uuid('claimed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
});

export type AbbrefyMigration = typeof abbrefyMigrations.$inferSelect;
export type NewAbbrefyMigration = typeof abbrefyMigrations.$inferInsert;
