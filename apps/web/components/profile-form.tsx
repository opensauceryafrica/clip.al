'use client';

import { Button, Input, Label } from '@clipal/ui';
import { useActionState } from 'react';
import { updateProfileAction } from '@/app/(app)/settings/actions';
import type { FormActionState } from '@/lib/action-state';

const initialState: FormActionState = {};

export function ProfileForm({ displayName, email }: { displayName: string; email: string }) {
  const [state, formAction, pending] = useActionState(updateProfileAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} disabled readOnly />
        <p className="text-xs text-zinc-500">Your email is your identity and can’t be changed here.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={displayName}
          maxLength={80}
          placeholder="Optional"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        {state.ok ? <span className="text-sm text-emerald-600">Saved.</span> : null}
        {state.error ? <span className="text-sm text-red-600">{state.error}</span> : null}
      </div>
    </form>
  );
}
