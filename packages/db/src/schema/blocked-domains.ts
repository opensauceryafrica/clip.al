import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { blockMatch, brandTermPolicy } from './enums';
import { users } from './users';

/**
 * The unified blocklist (§14.1, §14.13). Each entry is a `value` matched against
 * a destination, with:
 *  - `match` = 'domain' (exact eTLD+1, e.g. paypal.com) or 'keyword' (substring of
 *    the hostname where the SLD isn't exactly the term, e.g. flag paypal-login.com).
 *  - `policy` = 'reject' (refuse at submission) or 'flag' (allow but queue for
 *    review).
 * Table/column keep the historical `blocked_domains`/`domain` names; `domain`
 * holds the value for both match types. Former brand terms are keyword entries.
 * null added_by = seeded.
 */
export const blockedDomains = pgTable(
  'blocked_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    domain: text('domain').notNull(), // the value (eTLD+1 for 'domain', substring for 'keyword')
    match: blockMatch('match').notNull().default('domain'),
    policy: brandTermPolicy('policy').notNull().default('reject'),
    reason: text('reason').notNull(),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('blocked_domains_domain_key').on(t.domain),
    index('blocked_domains_match_idx').on(t.match),
  ],
);

export type BlockedDomain = typeof blockedDomains.$inferSelect;
export type NewBlockedDomain = typeof blockedDomains.$inferInsert;
