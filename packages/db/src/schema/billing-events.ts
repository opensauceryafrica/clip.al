import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { billingProcessor } from './enums';

/**
 * Idempotency log for inbound billing webhooks (replaces Phase 2 spec's
 * `paystack_events`; now dual-processor). A row is inserted before processing;
 * processing stamps `processed_at`. The `(processor, event_id)` composite UNIQUE
 * makes redelivered webhooks a no-op insert.
 */
export const billingEvents = pgTable(
  'billing_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    processor: billingProcessor('processor').notNull(),
    // Processor-side event id (Paystack event id / Polar webhook delivery id).
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('billing_events_processor_event_key').on(t.processor, t.eventId)],
);

export type BillingEvent = typeof billingEvents.$inferSelect;
export type NewBillingEvent = typeof billingEvents.$inferInsert;
