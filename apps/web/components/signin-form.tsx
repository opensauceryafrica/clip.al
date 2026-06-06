'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Spinner } from '@clipal/ui';
import { useActionState } from 'react';
import { sendCodeAction } from '@/app/(auth)/actions';
import type { AuthState } from '@/lib/action-state';
import { TurnstileWidget } from './turnstile';

const initialState: AuthState = {};

export function SigninForm({ siteKey }: { siteKey: string }) {
  const [state, formAction, pending] = useActionState(sendCodeAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to clip.al</CardTitle>
        <p className="text-sm text-zinc-500">
          Enter your email and we’ll send a 6-digit code. No password, ever.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              placeholder="you@example.com"
            />
          </div>
          <TurnstileWidget siteKey={siteKey} />
          {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? (
              <>
                <Spinner /> Sending code
              </>
            ) : (
              'Send code'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
