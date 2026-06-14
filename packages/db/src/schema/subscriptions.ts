import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { billingProcessor, currency, planName, subInterval, subStatus } from './enums';
import { users } from './users';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    plan: planName('plan').notNull().default('free'),
    interval: subInterval('interval'),
    status: subStatus('status').notNull().default('active'),
    currency: currency('currency').notNull().default('NGN'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    // Dual-billing: which processor (if any) backs this subscription.
    processor: billingProcessor('processor'),
    // Paystack (NGN) identifiers.
    paystackCustomerCode: text('paystack_customer_code'),
    paystackSubscriptionCode: text('paystack_subscription_code'),
    paystackEmailToken: text('paystack_email_token'),
    // Polar.sh (USD) identifiers.
    polarCustomerId: text('polar_customer_id'),
    polarSubscriptionId: text('polar_subscription_id'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('subscriptions_paystack_sub_idx').on(t.paystackSubscriptionCode),
    index('subscriptions_polar_sub_idx').on(t.polarSubscriptionId),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
