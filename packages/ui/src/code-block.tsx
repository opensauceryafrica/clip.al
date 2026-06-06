'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from './cn';

/** Mono string with a copy button (used for short URLs, IDs). */
export function CodeBlock({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op
    }
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900',
        className,
      )}
    >
      <code className="truncate font-mono text-sm text-zinc-950 dark:text-zinc-50">{value}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy'}
        className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-950 focus-visible:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
