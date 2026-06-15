import {
  currencies,
  DEFAULT_PRICES,
  intervals,
  planNames,
  type Currency,
  type PlanName,
} from '@clipal/config';
import { db, eq, planPrices } from '@clipal/db';
import { Badge, Button, Input } from '@clipal/ui';
import type { Metadata } from 'next';
import { adminUpsertPlanPriceAction } from '@/app/(admin)/actions';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';

export const metadata: Metadata = { title: 'Admin · Pricing' };
export const dynamic = 'force-dynamic';

const PLAN_LABEL: Record<PlanName, string> = {
  free: 'Free',
  pro: 'Pro',
  business: 'Business',
};

/** Paid plans only — Free is always 0 and not overridable. */
const PAID_PLANS = planNames.filter((p): p is Exclude<PlanName, 'free'> => p !== 'free');

function formatMinor(amountMinor: number, currency: Currency): string {
  if (currency === 'NGN') {
    return `₦${Math.round(amountMinor / 100).toLocaleString('en-NG')}`;
  }
  return `$${(amountMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const minorUnitLabel: Record<Currency, string> = { NGN: 'kobo', USD: 'cents' };

export default async function AdminPricingPage() {
  // Admin-only mutation; the page itself is viewable by moderators but the action
  // self-gates to role === 'admin'.
  await requireAdmin();

  const overrides = await db
    .select({
      plan: planPrices.plan,
      currency: planPrices.currency,
      interval: planPrices.interval,
      amountMinor: planPrices.amountMinor,
      active: planPrices.active,
    })
    .from(planPrices)
    .where(eq(planPrices.active, true));

  // Fast lookup of an active override for a (plan, currency, interval) triple.
  const overrideKey = (p: string, c: string, i: string) => `${p}:${c}:${i}`;
  const overrideMap = new Map<string, number>();
  for (const o of overrides) {
    overrideMap.set(overrideKey(o.plan, o.currency, o.interval), o.amountMinor);
  }

  return (
    <div>
      <PageHeader
        title="Pricing"
        description="Override the default plan prices per currency and interval. Amounts are in minor units (kobo / cents). Leave blank to revert to the code default."
      />

      <div className="space-y-8">
        {PAID_PLANS.map((plan) => (
          <section key={plan}>
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-muted text-xs font-semibold text-foreground">
                {plan.charAt(0).toUpperCase()}
              </span>
              <h2 className="text-sm font-semibold text-foreground">{PLAN_LABEL[plan]}</h2>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {currencies.map((currency) =>
                intervals.map((interval) => {
                  const def = DEFAULT_PRICES[plan][currency][interval];
                  const override = overrideMap.get(overrideKey(plan, currency, interval));
                  const effective = override ?? def;
                  return (
                    <form
                      key={`${plan}-${currency}-${interval}`}
                      action={adminUpsertPlanPriceAction}
                      className="rounded-lg border border-border bg-card p-4"
                    >
                      <input type="hidden" name="plan" value={plan} />
                      <input type="hidden" name="currency" value={currency} />
                      <input type="hidden" name="interval" value={interval} />

                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">
                          {currency} · {interval}
                        </span>
                        {override !== undefined ? (
                          <Badge variant="pending">override</Badge>
                        ) : (
                          <Badge variant="neutral">default</Badge>
                        )}
                      </div>

                      <p className="mb-3 text-xs text-muted-foreground">
                        Effective:{' '}
                        <span className="font-medium text-foreground">
                          {formatMinor(effective, currency)}
                        </span>{' '}
                        · default {formatMinor(def, currency)}
                      </p>

                      <label className="block text-[11px] text-muted-foreground">
                        Amount ({minorUnitLabel[currency]})
                      </label>
                      <div className="mt-1 flex items-center gap-2">
                        <Input
                          type="number"
                          name="amountMinor"
                          min={0}
                          step={1}
                          defaultValue={override !== undefined ? String(override) : ''}
                          placeholder={String(def)}
                          className="max-w-[10rem]"
                        />
                        <Button type="submit" variant="secondary" size="sm">
                          Save
                        </Button>
                      </div>
                    </form>
                  );
                }),
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
