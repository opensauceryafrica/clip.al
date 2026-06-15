'use client';

import { Button, Card, CardContent, Input, Spinner } from '@clipal/ui';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useActionState } from 'react';
import type { FormActionState } from '@/lib/action-state';
import { submitPasswordAction } from './actions';

const initialState: FormActionState = {};

/**
 * The password gate rendered on the interstitial when a link is protected and
 * the visitor has no valid proof cookie. Submits to `submitPasswordAction`,
 * which sets the proof cookie + redirects back here on success, or returns an
 * error to re-render. Never reveals the destination.
 */
export function PasswordForm({ code }: { code: string }) {
  const [state, formAction, pending] = useActionState(submitPasswordAction, initialState);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="font-mono text-sm font-medium tracking-tight text-zinc-950 dark:text-zinc-50"
          >
            clip.al
          </Link>
          <span className="text-sm text-muted-foreground">Protected link</span>
        </div>

        <Card>
          <CardContent className="space-y-5 p-6">
            <div className="flex size-10 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground">
              <Lock className="size-4" aria-hidden />
            </div>

            <div className="space-y-1">
              <h1 className="text-base font-semibold tracking-tight text-foreground">
                This link is password protected
              </h1>
              <p className="text-sm text-muted-foreground">
                Enter the password set by the link owner to continue.
              </p>
            </div>

            <form action={formAction} className="space-y-3">
              <input type="hidden" name="code" value={code} />
              <Input
                type="password"
                name="password"
                autoComplete="off"
                autoFocus
                required
                placeholder="Password"
                aria-label="Password"
                aria-invalid={state.error ? true : undefined}
              />
              {state.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {state.error}
                </p>
              ) : null}
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? (
                  <>
                    <Spinner /> Unlocking
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          clip.al checks destinations for safety before redirecting.
        </p>
      </div>
    </div>
  );
}
