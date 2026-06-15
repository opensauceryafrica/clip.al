import { billingContext, effectivePrice } from '@clipal/billing';
import {
  currencies,
  intervals,
  PLANS,
  planNames,
  type Currency,
  type Interval,
  type PlanName,
} from '@clipal/config';
import { lookupCountry } from '@clipal/geo';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import {
  PricingTable,
  type FeatureRow,
  type PlanColumn,
  type PriceMatrix,
} from '@/components/pricing-table';
import { PricingFaq } from '@/components/pricing-faq';
import { getSessionUser } from '@/lib/auth';
import { getClientIp } from '@/lib/request';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple, transparent pricing for clip.al — Free, Pro, and Business. Pay in Naira or US Dollars.',
};

/** Plan badge letters and marketing copy per §13 (F / P / B). */
const PLAN_META: Record<
  PlanName,
  { badge: string; title: string; tagline: string }
> = {
  free: {
    badge: 'F',
    title: 'Free',
    tagline: 'Everything you need to start shortening and tracking links.',
  },
  pro: {
    badge: 'P',
    title: 'Pro',
    tagline: 'Custom domains, no interstitial, and the power features.',
  },
  business: {
    badge: 'B',
    title: 'Business',
    tagline: 'Routing, more seats, and higher limits for teams.',
  },
};

/** Numbers formatted for the comparison table. null limits ⇒ "Unlimited". */
function limit(n: number | null): string {
  return n === null ? 'Unlimited' : n.toLocaleString('en-US');
}

/** Build the feature comparison rows straight from PLANS (single source). */
function buildFeatureRows(): FeatureRow[] {
  const cell = <T,>(fn: (plan: PlanName) => T): Record<PlanName, T> =>
    ({
      free: fn('free'),
      pro: fn('pro'),
      business: fn('business'),
    }) as Record<PlanName, T>;

  return [
    {
      label: 'Links per month',
      values: cell((p) => limit(PLANS[p].limits.linksPerMonth)),
    },
    {
      label: 'Analytics retention',
      values: cell((p) => `${PLANS[p].limits.analyticsRetentionDays} days`),
    },
    {
      label: 'No interstitial on your links',
      values: cell((p) => !PLANS[p].limits.interstitialOnOwnedLinks),
    },
    {
      label: 'Custom back-halves',
      values: cell((p) => PLANS[p].capabilities.customSlugs),
    },
    {
      label: 'Password-protected links',
      values: cell((p) => PLANS[p].capabilities.password),
    },
    {
      label: 'Expiring links',
      values: cell((p) => PLANS[p].capabilities.expiry),
    },
    {
      label: 'QR codes',
      values: cell((p) => PLANS[p].capabilities.qr),
    },
    {
      label: 'A/B testing',
      values: cell((p) => PLANS[p].capabilities.abTesting),
    },
    {
      label: 'Geo routing',
      values: cell((p) => PLANS[p].capabilities.geoRouting),
    },
    {
      label: 'Device routing',
      values: cell((p) => PLANS[p].capabilities.deviceRouting),
    },
    {
      label: 'Custom domains',
      values: cell((p) => limit(PLANS[p].limits.customDomains)),
    },
    {
      label: 'API requests per month',
      values: cell((p) => limit(PLANS[p].limits.apiRequestsPerMonth)),
    },
    {
      label: 'Webhooks',
      values: cell((p) => limit(PLANS[p].limits.webhooks)),
    },
    {
      label: 'Bulk CSV import (rows)',
      values: cell((p) => limit(PLANS[p].limits.bulkImportMax)),
    },
    {
      label: 'Active A/B campaigns',
      values: cell((p) => limit(PLANS[p].limits.activeCampaigns)),
    },
    {
      label: 'Team seats',
      values: cell((p) => limit(PLANS[p].limits.teamSeats)),
    },
  ];
}

export default async function PricingPage() {
  const hdrs = await headers();
  const user = await getSessionUser();

  // Geo-route the *default* currency: NG ⇒ NGN, else USD. The client toggle can
  // still switch without navigating (AC10) — we ship both currencies' prices.
  const country = lookupCountry(getClientIp(hdrs));
  const { currency: defaultCurrency } = billingContext(country);

  // Server-compute every (plan, currency, interval) combo so the client can
  // switch currency/interval with zero round-trips. plan_prices overrides win.
  const matrix = {} as PriceMatrix;
  for (const plan of planNames) {
    const byCurrency = {} as Record<Currency, Record<Interval, number>>;
    for (const cur of currencies) {
      const byInterval = {} as Record<Interval, number>;
      for (const int of intervals) {
        byInterval[int] = await effectivePrice(plan, cur, int);
      }
      byCurrency[cur] = byInterval;
    }
    matrix[plan] = byCurrency;
  }

  // CTA targets: logged-out users go to /signin; logged-in users go to a
  // placeholder checkout href the billing-ui agent will wire. Free has no CTA.
  const checkoutHref = (plan: PlanName): string =>
    user ? `/billing?plan=${plan}` : '/signin';

  const columns: PlanColumn[] = [
    {
      name: 'free',
      ...PLAN_META.free,
      ctaHref: user ? '' : '/signin',
      ctaLabel: user ? 'Your free plan' : 'Get started free',
      highlightCta: false,
    },
    {
      name: 'pro',
      ...PLAN_META.pro,
      ctaHref: checkoutHref('pro'),
      ctaLabel: 'Choose Pro',
      highlightCta: true,
    },
    {
      name: 'business',
      ...PLAN_META.business,
      ctaHref: checkoutHref('business'),
      ctaLabel: 'Choose Business',
      highlightCta: false,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Pricing that scales with you
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-pretty text-muted-foreground">
          Start free, forever. Upgrade when you need custom domains, no interstitial, routing, and
          higher limits. Pay in Naira or US Dollars — your choice.
        </p>
      </div>

      <div className="mt-12">
        <PricingTable
          prices={matrix}
          columns={columns}
          features={buildFeatureRows()}
          defaultCurrency={defaultCurrency}
        />
      </div>

      <PricingFaq />
    </div>
  );
}
