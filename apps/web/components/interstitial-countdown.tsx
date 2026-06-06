'use client';

import { INTERSTITIAL_COUNTDOWN_SECONDS } from '@clipal/config/constants';
import { Button } from '@clipal/ui';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Countdown + Continue control (§15). The anchor is always focusable and
 * activates on click/Enter at any time; the countdown only delays the automatic
 * redirect. Continuing navigates to the /go route, which records the click and
 * 302s to the destination.
 */
export function InterstitialCountdown({ goHref }: { goHref: string }) {
  const [secondsLeft, setSecondsLeft] = useState(INTERSTITIAL_COUNTDOWN_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) {
      window.location.assign(goHref);
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, goHref]);

  return (
    <div className="space-y-2">
      <Button asChild className="w-full">
        <a href={goHref}>
          Continue to site
          <ArrowRight />
        </a>
      </Button>
      <p className="text-center text-xs text-zinc-500" aria-live="polite">
        {secondsLeft > 0 ? `Redirecting automatically in ${secondsLeft}s` : 'Redirecting…'}
      </p>
    </div>
  );
}
