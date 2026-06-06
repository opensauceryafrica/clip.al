import { pgTable, text } from 'drizzle-orm/pg-core';

/** Lowercased. Seeded from config RESERVED_SLUGS; admin-extendable. */
export const reservedSlugs = pgTable('reserved_slugs', {
  slug: text('slug').primaryKey(),
});

export type ReservedSlug = typeof reservedSlugs.$inferSelect;
export type NewReservedSlug = typeof reservedSlugs.$inferInsert;
