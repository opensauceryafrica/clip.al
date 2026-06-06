'use client';

import { Button, Input } from '@clipal/ui';
import { useActionState } from 'react';
import { editDestinationAction } from '@/app/(app)/links/[id]/actions';
import type { FormActionState } from '@/lib/action-state';

const initialState: FormActionState = {};

export function EditDestinationForm({
  linkId,
  destination,
}: {
  linkId: string;
  destination: string;
}) {
  const [state, formAction, pending] = useActionState(editDestinationAction, initialState);

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="linkId" value={linkId} />
        <Input
          name="destination"
          type="url"
          defaultValue={destination}
          required
          aria-label="Destination URL"
          className="flex-1 font-mono text-xs"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Destination updated.</p> : null}
    </form>
  );
}
