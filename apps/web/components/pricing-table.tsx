'use client';

import type { Currency, Interval, PlanName } from '@clipal/config';
import { Badge, Button, cn } from '@clipal/ui';
import { Check, Minus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { SegmentedToggle } from './pricing-toggle';

/**
 * Prices for every (plan, currency, interval) combo, computed on the server via
 * effectivePrice() and handed to the client so the currency/interval toggles
 * re-render WITHOUT navigation (AC10). Minor units (kobo / cents).
 */
export type PriceMatrix = Record<PlanName, Record<Currency, Record<Interval, number>>>;

export interface PlanColumn {
  name: PlanName;
  /** Badge letter per §13: F / P / B. */
  badge: string;
  title: string;
  tagline: string;
  /** href for the CTA. Empty string ⇒ no CTA (Free / current plan). */
  ctaHref: string;
  ctaLabel: string;
  /** Render the CTA as the prominent (primary) action. */
  highlightCta: boolean;
}

export interface FeatureRow {
  label: string;
  /** One cell per plan, indexed by plan name. `true`/`false` ⇒ check/dash. */
  values: Record<PlanName, string | boolean>;
}

const PLAN_ORDER: readonly PlanName[] = ['free', 'pro', 'business'];

function formatMinor(amountMinor: number, currency: Currency): string {
  if (amountMinor === 0) return currency === 'NGN' ? '₦0' : '$0';
  if (currency === 'NGN') {
    // Whole-naira pricing — drop the kobo, group thousands.
    return `₦${Math.round(amountMinor / 100).toLocaleString('en-NG')}`;
  }
  // USD shown to the cent.
  return `$${(amountMinor / 100).toFixed(2)}`;
}

/** Per-month equivalent string for a yearly plan, for the "billed yearly" hint. */
function perMonthHint(yearlyMinor: number, currency: Currency): string | null {
  if (yearlyMinor === 0) return null;
  const perMonth = yearlyMinor / 12;
  return currency === 'NGN'
    ? `≈ ₦${Math.round(perMonth / 100).toLocaleString('en-NG')}/mo`
    : `≈ $${(perMonth / 100).toFixed(2)}/mo`;
}

export function PricingTable({
  prices,
  columns,
  features,
  defaultCurrency,
}: {
  prices: PriceMatrix;
  columns: readonly PlanColumn[];
  features: readonly FeatureRow[];
  defaultCurrency: Currency;
}) {
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [interval, setInterval] = useState<Interval>('monthly');

  return (
    <div className="space-y-8">
      {/* Controls: currency + billing interval, both no-nav (AC10). */}
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
        <SegmentedToggle<Currency>
          ariaLabel="Currency"
          value={currency}
          onChange={setCurrency}
          options={[
            { value: 'NGN', label: '₦ NGN' },
            { value: 'USD', label: '$ USD' },
          ]}
        />
        <SegmentedToggle<Interval>
          ariaLabel="Billing interval"
          value={interval}
          onChange={setInterval}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'yearly', label: 'Yearly', hint: '2 months free' },
          ]}
        />
      </div>

      {/* Three equal columns, 1px borders, no shadows, no "most popular". */}
      <div className="grid gap-4 md:grid-cols-3">
        {columns.map((col) => {
          const amount = prices[col.name][currency][interval];
          const monthlyHint =
            interval === 'yearly' ? perMonthHint(amount, currency) : null;
          return (
            <div
              key={col.name}
              className="flex flex-col rounded-xl border border-border bg-card p-6"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-muted text-xs font-semibold text-foreground"
                  aria-hidden
                >
                  {col.badge}
                </span>
                <h3 className="text-sm font-semibold text-foreground">{col.title}</h3>
              </div>

              <p className="mt-2 text-sm text-muted-foreground">{col.tagline}</p>

              <div className="mt-5">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                    {formatMinor(amount, currency)}
                  </span>
                  {amount > 0 ? (
                    <span className="text-sm text-muted-foreground">
                      /{interval === 'yearly' ? 'yr' : 'mo'}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 h-4 text-xs text-muted-foreground">
                  {amount === 0
                    ? 'Free forever'
                    : monthlyHint
                      ? `Billed yearly · ${monthlyHint}`
                      : 'Billed monthly'}
                </p>
              </div>

              <div className="mt-5">
                {col.ctaHref ? (
                  <Button
                    asChild
                    variant={col.highlightCta ? 'primary' : 'secondary'}
                    className="w-full"
                  >
                    <Link
                      href={
                        // Carry the live interval into the checkout href so the
                        // billing-ui agent's action gets the right cadence.
                        col.ctaHref.includes('?')
                          ? `${col.ctaHref}&interval=${interval}`
                          : col.ctaHref
                      }
                    >
                      {col.ctaLabel}
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" className="w-full" disabled>
                    {col.ctaLabel}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Feature comparison. Monochrome; check = included, dash = not. */}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Features
              </th>
              {columns.map((col) => (
                <th
                  key={col.name}
                  className="px-4 py-3 text-center font-medium text-foreground"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Badge variant="neutral">{col.badge}</Badge>
                    <span className="hidden sm:inline">{col.title}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((row, i) => (
              <tr
                key={row.label}
                className={cn(i !== 0 && 'border-t border-border')}
              >
                <td className="px-4 py-3 text-left text-muted-foreground">
                  {row.label}
                </td>
                {PLAN_ORDER.map((plan) => {
                  const v = row.values[plan];
                  return (
                    <td
                      key={plan}
                      className="px-4 py-3 text-center text-foreground tabular-nums"
                    >
                      {v === true ? (
                        <Check
                          className="mx-auto size-4 text-foreground"
                          aria-label="Included"
                        />
                      ) : v === false ? (
                        <Minus
                          className="mx-auto size-4 text-muted-foreground/50"
                          aria-label="Not included"
                        />
                      ) : (
                        <span>{v}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
