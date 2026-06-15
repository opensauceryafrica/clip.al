'use client';

import { cn } from '@clipal/ui';

/**
 * Monochrome segmented control (§13). Two-or-more options; the active segment
 * gets a raised card surface, the rest stay muted. Pure presentational — the
 * parent owns the selected value, so toggling re-renders client-side WITHOUT
 * navigation (AC10).
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional sub-label, e.g. "2 months free" on the yearly segment. */
  hint?: string;
}

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-[color,background-color,transform] duration-150 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
            {opt.hint ? (
              <span
                className={cn(
                  'rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide',
                  active ? 'bg-muted text-muted-foreground' : 'text-muted-foreground/70',
                )}
              >
                {opt.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
