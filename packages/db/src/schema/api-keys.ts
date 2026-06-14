import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // First 8 chars of the key, displayed in UI (e.g. `clpl_live_a1b2c3d4...`).
    prefix: text('prefix').notNull(),
    // sha256 of the full key — keys are 256-bit random, so sha256 + timing-safe
    // compare is sufficient (no argon2 needed). See spec §14.2.
    keyHash: text('key_hash').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Fast lookup before the hash compare (spec §9 auth flow).
    index('api_keys_prefix_idx').on(t.prefix),
    index('api_keys_user_idx').on(t.userId),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
