import { DEFAULT_PRICES, type Currency, type Interval, type PlanName } from '@clipal/config';
import { and, db, eq, schema } from '@clipal/db';

/**
 * The price (in MINOR units — kobo for NGN, cents for USD) a user would pay for
 * `(plan, currency, interval)`. An ACTIVE `plan_prices` override row wins;
 * otherwise the code default from `DEFAULT_PRICES` applies. Free is always 0.
 *
 * Note the schema's interval enum is `sub_interval` ('monthly' | 'yearly'),
 * which is exactly the config `Interval` union, so no mapping is needed.
 */
export async function effectivePrice(
  plan: PlanName,
  currency: Currency,
  interval: Interval,
): Promise<number> {
  const [override] = await db
    .select({ amountMinor: schema.planPrices.amountMinor })
    .from(schema.planPrices)
    .where(
      and(
        eq(schema.planPrices.plan, plan),
        eq(schema.planPrices.currency, currency),
        eq(schema.planPrices.interval, interval),
        eq(schema.planPrices.active, true),
      ),
    )
    .limit(1);

  if (override) return override.amountMinor;
  return DEFAULT_PRICES[plan][currency][interval];
}
