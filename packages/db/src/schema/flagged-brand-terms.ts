import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { brandTermPolicy } from './enums';
import { users } from './users';

/**
 * Trademark/brand protection (§14.13). Seeded from config BRAND_TERMS; admin can
 * extend. `policy = 'reject'` hard-blocks a destination whose hostname contains
 * the term; `policy = 'flag'` lets it through but sets the link to pending_review.
 */
export const flaggedBrandTerms = pgTable('flagged_brand_terms', {
  term: text('term').primaryKey(), // lowercased
  policy: brandTermPolicy('policy').notNull().default('flag'),
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FlaggedBrandTerm = typeof flaggedBrandTerms.$inferSelect;
export type NewFlaggedBrandTerm = typeof flaggedBrandTerms.$inferInsert;
