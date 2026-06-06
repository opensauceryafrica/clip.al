import { env } from '@clipal/config';
import { Button } from '@clipal/ui';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { ShortenForm } from '@/components/shorten-form';

const FEATURES = [
  {
    title: 'Anonymous by default',
    body: 'No signup required to shorten. Turnstile keeps the bots out; you keep your link.',
  },
  {
    title: 'Safe destinations',
    body: 'Every URL is scanned at submission and re-checked over time against Google Safe Browsing.',
  },
  {
    title: 'Built for billions',
    body: 'Edge-style caching and async analytics, designed so your redirects never slow down.',
  },
];

const COMING_SOON = [
  'Custom domains',
  'Link trees',
  'Geo & device routing',
  'Password-protected links',
  'Paid plans via Paystack',
];

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-6">
      <section className="py-20 sm:py-28">
        <h1 className="max-w-2xl text-balance text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-4xl">
          Short links. Real analytics. Built to last.
        </h1>
        <p className="mt-4 max-w-xl text-pretty text-zinc-600 dark:text-zinc-400">
          A fast, safe URL shortener and link manager. Anonymous by default, scanned for safety at
          submission and over time, and engineered so redirects never slow down — even at a billion
          links.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/signin">Get started</Link>
          </Button>
          <Button asChild variant="secondary">
            <a href="https://github.com/" target="_blank" rel="noopener noreferrer">
              View on GitHub
              <ArrowUpRight />
            </a>
          </Button>
        </div>

        <div className="mt-10 max-w-2xl">
          <ShortenForm siteKey={env.TURNSTILE_SITE_KEY} />
        </div>
      </section>

      <section className="grid gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="bg-zinc-50 p-6 dark:bg-zinc-950">
            <h2 className="text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {f.title}
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="py-16">
        <h2 className="text-sm font-medium text-zinc-500">What’s coming</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {COMING_SOON.map((item) => (
            <li
              key={item}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
            >
              {item}
              <span className="font-mono text-xs text-zinc-400">soon</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
