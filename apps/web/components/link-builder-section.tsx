'use client';

import { Badge } from '@clipal/ui';
import { ChevronDown, Lock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * A collapsible advanced-options section for the link builder. Uses a native
 * `<details>` so it works without JS and keeps motion to a single rotate on the
 * chevron. When `locked` is true the body is dimmed + non-interactive and a plan
 * Badge + Upgrade hint is shown (the server action still enforces the gate; this
 * is purely guidance).
 */
export function LinkBuilderSection({
  title,
  description,
  locked = false,
  requiredPlan,
  children,
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  locked?: boolean;
  /** Shown in the plan Badge, e.g. 'Pro' or 'Business'. */
  requiredPlan?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="group rounded-lg border border-border bg-card"
      {...(defaultOpen && !locked ? { open: true } : {})}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{title}</span>
            {locked && requiredPlan ? (
              <Badge variant="neutral" className="gap-1">
                <Lock className="size-3" aria-hidden />
                {requiredPlan}
              </Badge>
            ) : null}
          </div>
          {description ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
      </summary>

      <div className="border-t border-border px-4 py-4">
        {locked ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {requiredPlan ? `Available on the ${requiredPlan} plan.` : 'Not available on your plan.'}{' '}
              <Link
                href="/billing"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Upgrade
              </Link>{' '}
              to unlock.
            </p>
            {/* A disabled fieldset removes its controls from form submission and
                blocks interaction — exactly the "guidance only" behaviour we want. */}
            <fieldset
              disabled
              className="m-0 min-w-0 border-0 p-0 opacity-50 [&>*]:pointer-events-none"
            >
              {children}
            </fieldset>
          </div>
        ) : (
          children
        )}
      </div>
    </details>
  );
}
