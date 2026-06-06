import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

/** Label/value pairs used across detail pages (§13). */
export function KeyValue({ className, ...props }: ComponentProps<'dl'>) {
  return <dl className={cn('divide-y divide-zinc-200 dark:divide-zinc-800', className)} {...props} />;
}

export function KeyValueRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2.5', className)}>
      <dt className="shrink-0 text-sm text-zinc-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-zinc-950 dark:text-zinc-50">{children}</dd>
    </div>
  );
}
