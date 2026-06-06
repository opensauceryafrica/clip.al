import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext } from './columns';
import { userRole, userStatus } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull().unique(),
    displayName: text('display_name'),
    role: userRole('role').notNull().default('user'),
    status: userStatus('status').notNull().default('active'),
    migratedFromAbbrefy: boolean('migrated_from_abbrefy').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // email already has a unique (case-insensitive via citext) index.
  (t) => [index('users_status_idx').on(t.status)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
