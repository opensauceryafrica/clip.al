'use client';

import { Button } from '@clipal/ui';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Copy a delivery's stored JSON payload to the clipboard. */
export function CopyPayloadButton({ payload }: { payload: unknown }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op
    }
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={copy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy payload'}
    </Button>
  );
}
