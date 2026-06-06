import type { ReactNode } from 'react';
import { cn } from './cn';

/** A single line of secondary text + an optional CTA. No illustrations (§13). */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-200 px-6 py-12 text-center dark:border-zinc-800',
        className,
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">{title}</p>
        {description ? <p className="text-sm text-zinc-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
