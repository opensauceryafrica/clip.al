import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/** eTLD+1 granularity, lowercased, no scheme/path. null added_by = seeded list. */
export const blockedDomains = pgTable(
  'blocked_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    domain: text('domain').notNull(),
    reason: text('reason').notNull(),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('blocked_domains_domain_key').on(t.domain)],
);

export type BlockedDomain = typeof blockedDomains.$inferSelect;
export type NewBlockedDomain = typeof blockedDomains.$inferInsert;
