import 'server-only';
import { publicUrl } from '@clipal/s3';
import { cn } from '@clipal/ui';
import { selectAd, type AdSlotName } from '@/lib/ads';

/**
 * <AdSlot> — renders a single ad slot inside an interstitial (spec §10 + §14.7).
 *
 * The caller MUST have already passed the bot-defense gate (`shouldRenderAds`)
 * before mounting this component; `consent` is threaded through only so the
 * AdSense fallback can stay aligned with the CMP signal. We never render
 * AdSense Auto Ads — only a manual <ins> unit in a named slot.
 *
 * Layout: a fixed leaderboard-style box (max 728×90, responsive down) is always
 * reserved so the surrounding interstitial doesn't shift when an ad does or
 * doesn't fill. When there's nothing to show the box is collapsed and
 * `aria-hidden`.
 *
 * The component is async (server component): it reads sponsored inventory via
 * `selectAd`, then renders either:
 *   - a sponsored <a><img></a> + a 1×1 impression beacon, or
 *   - a manual AdSense <ins> unit, or
 *   - an empty, hidden, reserved box.
 */
export async function AdSlot({
  slot,
  consent,
  className,
}: {
  slot: AdSlotName;
  consent: boolean;
  className?: string;
}) {
  // Defensive: if consent was withdrawn between the gate and here, render empty.
  const selection = consent ? await selectAd(slot) : { kind: 'none' as const };

  const boxClass = cn(
    'mx-auto flex w-full max-w-[728px] items-center justify-center overflow-hidden',
    className,
  );

  if (selection.kind === 'sponsored') {
    const href = `/api/ads/click/${encodeURIComponent(selection.id)}`;
    const impression = `/api/ads/impression/${encodeURIComponent(selection.id)}`;
    const src = publicUrl(selection.imageKey);
    return (
      <div
        className={cn(boxClass, 'min-h-[90px]')}
        data-ad-slot={slot}
        data-ad-kind="sponsored"
      >
        <a
          href={href}
          target="_blank"
          rel="nofollow noopener sponsored"
          aria-label={`Sponsored: ${selection.advertiserName}`}
          className="group relative block transition-opacity hover:opacity-95 active:opacity-90"
        >
          <img
            src={src}
            alt={`Sponsored by ${selection.advertiserName}`}
            width={728}
            height={90}
            loading="lazy"
            decoding="async"
            className="block h-auto max-h-[90px] w-full max-w-[728px] rounded-md border border-border object-contain"
          />
          <span className="pointer-events-none absolute right-1 top-1 rounded-sm bg-background/80 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Ad
          </span>
        </a>
        {/* Impression beacon: a 1×1 image GET to the beacon endpoint. The
            client-side enhancement below upgrades it to sendBeacon when
            available; this <img> guarantees a count even with JS disabled. */}
        <img
          src={impression}
          alt=""
          width={1}
          height={1}
          aria-hidden="true"
          className="absolute h-px w-px opacity-0"
          style={{ position: 'absolute', left: -9999 }}
        />
        <ImpressionBeacon id={selection.id} />
      </div>
    );
  }

  if (selection.kind === 'adsense') {
    // Manual AdSense unit in a NAMED slot. No Auto Ads. The loader script
    // (adsbygoogle.js) is injected by the interstitial host (orchestrator),
    // which also registers the AdSense CSP domains; here we only mount the
    // <ins> and request a fill.
    const adSlotId = ADSENSE_SLOT_IDS[slot];
    return (
      <div
        className={cn(boxClass, 'min-h-[90px]')}
        data-ad-slot={slot}
        data-ad-kind="adsense"
      >
        <ins
          className="adsbygoogle block"
          style={{ display: 'block', width: '100%', maxWidth: 728, height: 90 }}
          data-ad-client={selection.clientId}
          data-ad-slot={adSlotId}
          data-ad-format="horizontal"
          data-full-width-responsive="false"
        />
        <script
          // Request a fill for this specific <ins>. Safe to push multiple times;
          // AdSense fills the next un-filled unit on the page.
          dangerouslySetInnerHTML={{
            __html: '(adsbygoogle = window.adsbygoogle || []).push({});',
          }}
        />
      </div>
    );
  }

  // Nothing to show: keep the reserved (collapsed) box but hide it from a11y +
  // layout-shift perspective.
  return (
    <div
      className={cn(boxClass, 'h-0')}
      data-ad-slot={slot}
      data-ad-kind="none"
      aria-hidden="true"
    />
  );
}

/**
 * Per-slot AdSense unit ids. These are the manual <ins data-ad-slot> values that
 * must be created in the AdSense console for each named placement.
 *
 * TODO(@owner): replace these placeholders with the real unit ids once the
 * AdSense units are provisioned (or thread them in via env).
 */
const ADSENSE_SLOT_IDS: Record<AdSlotName, string> = {
  interstitial_top: '0000000001',
  interstitial_bottom: '0000000002',
  tree_top: '0000000003',
};

/**
 * Progressive-enhancement impression beacon: when JS + navigator.sendBeacon are
 * available, fire a POST (more reliable than an <img> on unload, and matches the
 * impression endpoint's POST contract). The no-JS <img> above is the fallback.
 * Rendered as an inline module script so it runs once per slot.
 */
function ImpressionBeacon({ id }: { id: string }) {
  const url = `/api/ads/impression/${encodeURIComponent(id)}`;
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `try{if(navigator.sendBeacon){navigator.sendBeacon(${JSON.stringify(
          url,
        )});}}catch(e){}`,
      }}
    />
  );
}
