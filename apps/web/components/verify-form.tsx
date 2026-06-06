'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '@clipal/ui';
import Link from 'next/link';
import { useActionState, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { verifyCodeAction } from '@/app/(auth)/actions';
import type { AuthState } from '@/lib/action-state';
import { TurnstileWidget } from './turnstile';

const initialState: AuthState = {};
const LENGTH = 6;

export function VerifyForm({ email, siteKey }: { email: string; siteKey: string }) {
  const [state, formAction, pending] = useActionState(verifyCodeAction, initialState);
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(''));
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const code = digits.join('');

  function setDigit(index: number, raw: string): void {
    const value = raw.replace(/\D/g, '').slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (value && index < LENGTH - 1) refs.current[index + 1]?.focus();
  }

  function onKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>): void {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    if (!text) return;
    e.preventDefault();
    const next = Array(LENGTH).fill('');
    for (let i = 0; i < text.length; i++) next[i] = text[i] ?? '';
    setDigits(next);
    refs.current[Math.min(text.length, LENGTH - 1)]?.focus();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enter your code</CardTitle>
        <p className="text-sm text-zinc-500">
          We sent a 6-digit code to <span className="font-medium text-zinc-700 dark:text-zinc-300">{email}</span>. It expires in 10 minutes.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="code" value={code} />
          <div className="flex justify-between gap-2" onPaste={onPaste}>
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={digit}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={1}
                aria-label={`Digit ${i + 1}`}
                autoFocus={i === 0}
                className="h-12 w-full rounded-md border border-zinc-200 bg-white text-center font-mono text-lg text-zinc-950 focus-visible:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/10 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
            ))}
          </div>
          <TurnstileWidget siteKey={siteKey} />
          {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
          <Button type="submit" disabled={pending || code.length < LENGTH} className="w-full">
            {pending ? (
              <>
                <Spinner /> Verifying
              </>
            ) : (
              'Verify'
            )}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-500">
          Didn’t get it?{' '}
          <Link href="/signin" className="font-medium text-zinc-950 underline underline-offset-2 dark:text-zinc-50">
            Send a new code
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
