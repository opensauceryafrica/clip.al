import type { ReactNode } from 'react';

/**
 * Static FAQ for /pricing. Server component (no interactivity) — neutral,
 * Africa-first copy explaining the NGN/USD split and how billing works.
 */
const FAQ: ReadonlyArray<{ q: string; a: ReactNode }> = [
  {
    q: 'Why do I see prices in Naira (or in Dollars)?',
    a: 'We price for where you are. Visitors in Nigeria are billed in NGN (₦) through Paystack; everyone else is billed in USD ($). You can preview either with the ₦/$ toggle above — it does not change your account.',
  },
  {
    q: 'Which payment methods can I use?',
    a: 'NGN payments go through Paystack (cards, bank transfer, USSD). USD payments are handled by Polar.sh, our merchant of record, which also takes care of any applicable taxes.',
  },
  {
    q: 'What does "billed yearly" save me?',
    a: 'Annual plans are priced at ten months — so you get two months free versus paying monthly. Switch the Monthly/Yearly toggle above to compare.',
  },
  {
    q: 'Can I change or cancel my plan?',
    a: 'Yes. Upgrade, downgrade, or cancel anytime from your billing settings. Cancellations stay active until the end of the period you have already paid for.',
  },
  {
    q: 'Is there a free plan?',
    a: 'Always. The Free plan covers anonymous and signed-in shortening with real analytics. Upgrade only when you need custom domains, no interstitial, higher limits, or routing.',
  },
];

export function PricingFaq() {
  return (
    <section className="mx-auto mt-20 max-w-3xl">
      <h2 className="text-center text-lg font-semibold tracking-tight text-foreground">
        Frequently asked questions
      </h2>
      <dl className="mt-8 divide-y divide-border rounded-xl border border-border">
        {FAQ.map((item) => (
          <div key={item.q} className="px-5 py-5">
            <dt className="text-sm font-medium text-foreground">{item.q}</dt>
            <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
