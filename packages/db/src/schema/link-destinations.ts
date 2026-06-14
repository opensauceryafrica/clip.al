import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { links } from './links';

/**
 * Shape of the `match` rule a destination is selected by. The redirect resolver
 * evaluates rows in `order` ascending; first match wins. For `ab` mode every
 * row is treated as a weighted pool member.
 */
export type DestinationMatch =
  | { type: 'geo'; countries: string[] }
  | { type: 'device'; device: 'mobile' | 'tablet' | 'desktop' | 'bot' }
  | { type: 'ab'; weight: number };

export const linkDestinations = pgTable(
  'link_destinations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    match: jsonb('match').$type<DestinationMatch>().notNull(),
    destinationUrl: text('destination_url').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => [index('link_destinations_link_idx').on(t.linkId, t.order)],
);

export type LinkDestination = typeof linkDestinations.$inferSelect;
export type NewLinkDestination = typeof linkDestinations.$inferInsert;
