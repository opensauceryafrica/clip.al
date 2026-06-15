'use client';

/**
 * CookieConsent — clip.al's self-rolled CMP banner (spec §10 + §14.5).
 *
 * Shown on first visit only (no prior `clipal_consent` cookie). Explains the
 * cookie categories (essential = always on; advertising = optional), offers
 * Accept / Reject, and links to /privacy. The choice is persisted for 1 year via
 * POST /api/consent (server-set cookie, identical shape to the read helper), with
 * a `document.cookie` fallback so the banner never reappears even if the network
 * call fails. Once any decision exists, the banner never renders again.
 *
 * COMPLIANCE: ad scripts must NOT load before consent. This component only
 * RECORDS the choice — the actual ad gate lives server-side in
 * `lib/consent.hasAdsConsent`, which the interstitial AdSlot consults. For
 * EU/UK/CA visitors that gate defaults to NO ads until Accept is pressed here;
 * elsewhere a lighter notice applies but the choice is still recorded.
 *
 * The orchestrator mounts <CookieConsent /> once in the root layout.
 */
import { Button } from '@clipal/ui';
import { useEffect, useState } from 'react';
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  encodeConsent,
  hasDecided,
} from '@/lib/consent';

/** Client-side fallback writer (host-only, lax) used if the API call fails. */
function writeConsentCookie(ads: boolean): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${CONSENT_COOKIE}=${encodeURIComponent(encodeConsent(ads))}` +
    `; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function CookieConsent(): React.ReactElement | null {
  // Start hidden so SSR never flashes the banner; decide on mount from the cookie.
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // `document.cookie` is the only client-readable source; getConsent/hasDecided
    // accept a raw Cookie-header string, which is exactly its shape.
    if (!hasDecided(document.cookie)) setOpen(true);
  }, []);

  async function choose(ads: boolean): Promise<void> {
    setPending(true);
    // Hide immediately for responsiveness; persist in the background.
    setOpen(false);
    try {
      const res = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ads }),
        // same-origin so the Origin header is sent for the CSRF check.
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`consent persist failed: ${res.status}`);
    } catch {
      // Network/route failure → still remember the choice client-side so the
      // banner won't nag on the next load.
      writeConsentCookie(ads);
    } finally {
      setPending(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 sm:p-6"
    >
      <div className="w-full max-w-3xl rounded-lg border border-border bg-card text-card-foreground shadow-lg shadow-black/20">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            We use{' '}
            <span className="font-medium text-foreground">essential cookies</span> to run
            clip.al (these are always on). With your permission we also use{' '}
            <span className="font-medium text-foreground">advertising cookies</span> to show
            ads on shared links. You can change your mind anytime. See our{' '}
            <a
              href="/privacy"
              className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
            >
              Privacy Policy
            </a>
            .
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => void choose(false)}
            >
              Reject
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={() => void choose(true)}
            >
              Accept
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CookieConsent;
