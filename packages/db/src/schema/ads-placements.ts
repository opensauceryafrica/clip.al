import { bigint, boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { adSlot } from './enums';

export const adsPlacements = pgTable(
  'ads_placements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slot: adSlot('slot').notNull(),
    advertiserName: text('advertiser_name').notNull(),
    // MinIO object key for the creative.
    imageUrl: text('image_url').notNull(),
    clickUrl: text('click_url').notNull(),
    weight: integer('weight').notNull().default(1),
    active: boolean('active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    impressions: bigint('impressions', { mode: 'number' }).notNull().default(0),
    clicks: bigint('clicks', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // Render-time selection: active placements for a given slot.
  (t) => [index('ads_placements_slot_active_idx').on(t.slot, t.active)],
);

export type AdsPlacement = typeof adsPlacements.$inferSelect;
export type NewAdsPlacement = typeof adsPlacements.$inferInsert;
