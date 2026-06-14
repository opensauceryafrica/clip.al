import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ExpiredPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <span className="font-mono text-sm font-medium tracking-tight text-zinc-950 dark:text-zinc-50">
        clip.al
      </span>
      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        This link has expired
      </h1>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        The owner set this short link to stop working after a certain date, and that date has
        passed.
      </p>
      <Link
        href="/"
        className="mt-8 text-sm font-medium text-zinc-950 underline underline-offset-4 dark:text-zinc-50"
      >
        Create your own short link →
      </Link>
    </main>
  );
}
