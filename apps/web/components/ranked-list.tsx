import type { NamedCount } from '@clipal/ch';
import { formatNumber } from '@/lib/format';

/** Label + count rows with a proportional monochrome bar. */
export function RankedList({
  title,
  items,
  empty = 'No data yet.',
}: {
  title: string;
  items: NamedCount[];
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.clicks));
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-medium text-zinc-950 dark:text-zinc-50">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="relative isolate">
              <div
                className="absolute inset-y-0 left-0 -z-10 rounded-sm bg-zinc-100 dark:bg-zinc-800"
                style={{ width: `${(item.clicks / max) * 100}%` }}
                aria-hidden
              />
              <div className="flex items-center justify-between px-2 py-1 text-sm">
                <span className="truncate text-zinc-700 dark:text-zinc-300">{item.name || '—'}</span>
                <span className="ml-2 shrink-0 tabular-nums text-zinc-500">
                  {formatNumber(item.clicks)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
