import type { ComponentProps } from 'react';
import { cn } from './cn';

type BadgeVariant = 'neutral' | 'active' | 'disabled' | 'pending' | 'danger';

/**
 * Status pill. Chrome stays monochrome (zinc border/bg); a small colored dot
 * carries the status — keeps the surface monochrome while still legible (§13).
 */
const DOT: Record<BadgeVariant, string> = {
  neutral: '',
  active: 'bg-emerald-500',
  disabled: 'bg-zinc-400',
  pending: 'bg-amber-500',
  danger: 'bg-red-500',
};

export function Badge({
  variant = 'neutral',
  className,
  children,
  ...props
}: ComponentProps<'span'> & { variant?: BadgeVariant }) {
  const dot = DOT[variant];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300',
        className,
      )}
      {...props}
    >
      {dot ? <span className={cn('size-1.5 rounded-full', dot)} aria-hidden /> : null}
      {children}
    </span>
  );
}
