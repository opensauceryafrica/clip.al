'use client';

import { Button, Input } from '@clipal/ui';
import { Plus } from 'lucide-react';
import { useActionState, useEffect, useRef } from 'react';
import type { FormActionState } from '@/lib/action-state';
import { addDomainAction } from './actions';

const initial: FormActionState = {};

/**
 * Inline add-domain form. On success the action revalidates `/domains` (the new
 * row shows up server-rendered) and we clear the input. Plan-gated upstream —
 * this only renders when the user has remaining custom-domain capacity.
 */
export function DomainAddForm() {
  const [state, formAction, pending] = useActionState(addDomainAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="mb-6 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <label htmlFor="domain" className="text-sm font-medium text-foreground">
            Add a custom domain
          </label>
          <Input
            id="domain"
            name="domain"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="go.yourbrand.com"
            required
          />
        </div>
        <Button type="submit" size="sm" disabled={pending} className="sm:mb-0.5">
          <Plus className="size-4" />
          {pending ? 'Adding…' : 'Add domain'}
        </Button>
      </div>
      {state.error ? (
        <p className="mt-2 text-sm text-destructive">{state.error}</p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Use a subdomain you control (e.g. <span className="font-mono">go.yourbrand.com</span>).
          You&apos;ll add two DNS records to verify it.
        </p>
      )}
    </form>
  );
}
