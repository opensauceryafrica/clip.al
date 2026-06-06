import type { ReactNode } from 'react';

/** Shared wrapper for legal pages. Renders a clear "draft — pending review" note. */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-8 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated {updated}</p>
        <p className="mt-4 rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Draft — placeholder copy pending legal review. Not final or legally binding.
        </p>
      </header>
      <div className="space-y-4 text-sm leading-relaxed text-zinc-700 [&_a]:underline [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-zinc-950 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 dark:text-zinc-300 dark:[&_h2]:text-zinc-50">
        {children}
      </div>
    </article>
  );
}
