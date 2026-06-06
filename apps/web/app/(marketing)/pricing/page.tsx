import { Button } from '@clipal/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Pricing' };

// Real plans (Pro & Business, NGN-first via Paystack) arrive in Phase 2.
export default function PricingPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Pricing
      </h1>
      <p className="mx-auto mt-3 max-w-md text-pretty text-zinc-600 dark:text-zinc-400">
        clip.al is free to use today. Pro &amp; Business plans — custom domains, no interstitial,
        higher limits, and team features — are coming soon.
      </p>
      <div className="mt-8 flex justify-center">
        <Button asChild>
          <Link href="/signin">Get started free</Link>
        </Button>
      </div>
    </div>
  );
}
