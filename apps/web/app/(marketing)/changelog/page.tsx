import { EmptyState } from '@clipal/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Changelog' };

// Empty shell, ready for MDX entries in a later phase.
export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Changelog
      </h1>
      <div className="mt-8">
        <EmptyState
          title="Nothing here yet"
          description="Product updates will show up here as clip.al evolves."
        />
      </div>
    </div>
  );
}
