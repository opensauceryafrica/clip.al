'use client';

import { Button, CodeBlock, Input, Spinner } from '@clipal/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import { shortenAction } from '@/app/(marketing)/actions';
import type { ShortenState } from '@/lib/action-state';
import { TurnstileWidget } from './turnstile';

const initialState: ShortenState = { ok: false };

export function ShortenForm({ siteKey }: { siteKey: string }) {
  const [state, formAction, pending] = useActionState(shortenAction, initialState);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex flex-1 items-center rounded-md border border-zinc-200 bg-white pl-3 focus-within:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950">
            <span className="select-none font-mono text-sm text-zinc-400">{'https://clip.al/'}</span>
            <Input
              name="url"
              type="url"
              inputMode="url"
              required
              aria-label="URL to shorten"
              placeholder="paste a long link"
              className="border-0 bg-transparent focus-visible:ring-0"
            />
          </div>
          <Button type="submit" disabled={pending} className="sm:w-32">
            {pending ? (
              <>
                <Spinner /> Shortening
              </>
            ) : (
              'Shorten'
            )}
          </Button>
        </div>
        <TurnstileWidget siteKey={siteKey} />
      </form>

      {state.ok && state.shortUrl ? (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <CodeBlock value={state.shortUrl} />
          {state.flagged ? (
            <p className="text-xs text-zinc-500">
              This link is live but queued for a quick safety review (it resembles a known brand).
            </p>
          ) : null}
          {state.anonymous ? (
            <p className="text-sm text-zinc-500">
              Want clicks, analytics, and edit controls?{' '}
              <Link href="/signin" className="font-medium text-zinc-950 underline underline-offset-2 dark:text-zinc-50">
                Sign in to claim this link
              </Link>{' '}
              within 24 hours.
            </p>
          ) : null}
        </div>
      ) : null}

      {!state.ok && state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </div>
  );
}
