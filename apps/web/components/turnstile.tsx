'use client';

import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile widget (§14.3) using EXPLICIT rendering.
 *
 * Implicit rendering (api.js auto-scanning `.cf-turnstile` on load) is unreliable
 * in an App Router SPA: the auto-scan runs once when the script first executes,
 * so a client-side navigation to this form — or a remount after the script is
 * already cached — leaves the widget unrendered. No widget means no
 * `cf-turnstile-response` token, so the server rejects the captcha until a full
 * reload re-triggers the scan.
 *
 * Explicit rendering fixes this: load api.js once, then call `turnstile.render()`
 * in an effect every time this component mounts, and `remove()` on unmount.
 * Turnstile injects the hidden `cf-turnstile-response` input into the enclosing
 * <form>, which the server actions read. With no site key (dev) it renders a note
 * and the action bypasses.
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // allow a retry on the next mount
      reject(new Error('failed to load Turnstile'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileWidget({ siteKey }: { siteKey: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!siteKey) return;
    let widgetId: string | undefined;
    let cancelled = false;

    loadTurnstile()
      .then(() => {
        const el = containerRef.current;
        if (cancelled || !el || !window.turnstile) return;
        if (el.childElementCount > 0) return; // already rendered (e.g. StrictMode)
        widgetId = window.turnstile.render(el, {
          sitekey: siteKey,
          theme: 'auto',
          size: 'flexible',
        });
      })
      .catch(() => {
        // Network/script failure — the server still enforces the captcha, so a
        // missing token fails closed, not open.
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          /* widget already gone */
        }
      }
    };
  }, [siteKey]);

  if (!siteKey) {
    return (
      <p className="text-xs text-muted-foreground">
        Turnstile isn’t configured — submissions are allowed in development.
      </p>
    );
  }

  return <div ref={containerRef} className="min-h-[65px]" />;
}
