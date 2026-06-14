import { bigint, boolean, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { currency, planName, subInterval } from './enums';

/**
 * Admin-configurable price overrides. When a row exists for a
 * (plan, currency, interval) triple it supersedes the code-default price in
 * `packages/config/plans.ts`; otherwise the code default applies.
 */
export const planPrices = pgTable(
  'plan_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    plan: planName('plan').notNull(),
    currency: currency('currency').notNull(),
    interval: subInterval('interval').notNull(),
    // kobo for NGN, cents for USD.
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('plan_prices_plan_currency_interval_key').on(t.plan, t.currency, t.interval)],
);

export type PlanPrice = typeof planPrices.$inferSelect;
export type NewPlanPrice = typeof planPrices.$inferInsert;
