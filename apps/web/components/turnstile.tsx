'use client';

import Script from 'next/script';

/**
 * Cloudflare Turnstile widget (§14.3). Uses implicit rendering: the api.js
 * auto-renders any `.cf-turnstile` element and injects a hidden
 * `cf-turnstile-response` input into the enclosing <form>, which server actions
 * read. With no site key (dev), renders a note and the action bypasses.
 */
export function TurnstileWidget({ siteKey }: { siteKey: string }) {
  if (!siteKey) {
    return (
      <p className="text-xs text-zinc-500">
        Turnstile isn’t configured — submissions are allowed in development.
      </p>
    );
  }
  return (
    <div>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        async
        defer
      />
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="auto" data-size="flexible" />
    </div>
  );
}
