import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { billingProcessor, currency, invoiceStatus } from './enums';
import { subscriptions } from './subscriptions';
import { users } from './users';

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    // Dual-billing: which processor issued this invoice.
    processor: billingProcessor('processor').notNull(),
    // Processor-side reference (Paystack reference or Polar order/invoice id).
    providerReference: text('provider_reference').notNull().unique(),
    // kobo for NGN, cents for USD.
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: currency('currency').notNull(),
    status: invoiceStatus('status').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    pdfUrl: text('pdf_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoices_user_idx').on(t.userId, t.createdAt.desc()),
    index('invoices_status_idx').on(t.status),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
