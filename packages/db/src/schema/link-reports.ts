import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { inet } from './columns';
import { reportReason } from './enums';
import { links } from './links';
import { users } from './users';

export const linkReports = pgTable(
  'link_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    reason: reportReason('reason').notNull(),
    note: text('note'),
    reporterIp: inet('reporter_ip'),
    reporterUserId: uuid('reporter_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('link_reports_link_created_idx').on(t.linkId, t.createdAt.desc())],
);

export type LinkReport = typeof linkReports.$inferSelect;
export type NewLinkReport = typeof linkReports.$inferInsert;
