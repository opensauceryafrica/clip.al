import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Help' };

const FAQ = [
  {
    id: 'shorten',
    q: 'How do I shorten a link?',
    a: 'Paste a URL on the home page and press Shorten. No account is required, though signing in lets you manage links and see analytics.',
  },
  {
    id: 'interstitial',
    q: 'Why do I see a preview page before some links?',
    a: 'Anonymous and free links show a short preview page so you can see the destination and that it passed our safety checks before continuing. It also lets people report bad links. Paid users (coming soon) skip it.',
  },
  {
    id: 'safety',
    q: 'How does clip.al keep links safe?',
    a: 'Every destination is validated and scanned at submission against Google Safe Browsing, and re-checked on a rolling basis. Links flagged as malicious are disabled automatically.',
  },
  {
    id: 'claim',
    q: 'I shortened a link without signing in. Can I still manage it?',
    a: 'Yes — sign in within 24 hours on the same browser and the link will be added to your account.',
  },
  {
    id: 'abbrefy',
    q: 'I used abbrefy before. What happened to my links?',
    a: 'Your email is recognized, so signing in just works. Old abbrefy short links were not migrated; recreate any you still need.',
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Help</h1>
      <p className="mt-2 text-sm text-zinc-500">A few common questions. More to come.</p>
      <dl className="mt-8 divide-y divide-zinc-200 dark:divide-zinc-800">
        {FAQ.map((item) => (
          <div key={item.id} id={item.id} className="scroll-mt-20 py-5">
            <dt className="text-base font-medium text-zinc-950 dark:text-zinc-50">{item.q}</dt>
            <dd className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{item.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
