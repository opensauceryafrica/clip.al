'use client';

import { Button, Input } from '@clipal/ui';
import { useActionState } from 'react';
import { changeSlugAction } from '@/app/(app)/links/[id]/actions';
import type { FormActionState } from '@/lib/action-state';

const initialState: FormActionState = {};

export function EditSlugForm({
  linkId,
  code,
  baseUrl,
}: {
  linkId: string;
  code: string;
  baseUrl: string;
}) {
  const [state, formAction, pending] = useActionState(changeSlugAction, initialState);
  const host = baseUrl.replace(/^https?:\/\//, ''); // compact prefix, e.g. clip.al/

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="linkId" value={linkId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{host}/</span>
        <Input
          name="code"
          defaultValue={code}
          required
          minLength={4}
          maxLength={32}
          aria-label="Custom back-half"
          className="flex-1 font-mono text-xs"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Letters, numbers, hyphens, underscores (4–32). Changing this breaks the old short link;
        the analytics view follows the new back-half.
      </p>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Back-half updated.</p> : null}
    </form>
  );
}
