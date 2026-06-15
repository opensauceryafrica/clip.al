'use client';

import { Button, CodeBlock, Input, Label, Spinner } from '@clipal/ui';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { createPowerLinkAction, type PowerLinkState } from '@/app/(app)/links/new/actions';
import { LinkBuilderRulesEditor, type RulesMode } from './link-builder-rules-editor';
import { LinkBuilderSection } from './link-builder-section';

const initialState: PowerLinkState = {};

/** Which features the current plan permits — drives the lock UI. */
export interface BuilderCapabilities {
  customSlugs: boolean;
  password: boolean;
  expiry: boolean;
  geoRouting: boolean;
  deviceRouting: boolean;
  abTesting: boolean;
}

export interface CampaignOption {
  id: string;
  name: string;
}

const ROUTING_OPTIONS: { value: RulesMode; label: string; feature?: keyof BuilderCapabilities }[] = [
  { value: 'single', label: 'Single destination' },
  { value: 'geo', label: 'Geo routing', feature: 'geoRouting' },
  { value: 'device', label: 'Device routing', feature: 'deviceRouting' },
  { value: 'ab', label: 'A/B testing', feature: 'abTesting' },
];

export function LinkBuilderForm({
  baseUrl,
  caps,
  campaigns,
}: {
  baseUrl: string;
  caps: BuilderCapabilities;
  campaigns: CampaignOption[];
}) {
  const [state, formAction, pending] = useActionState(createPowerLinkAction, initialState);
  const [mode, setMode] = useState<RulesMode>('single');
  const host = baseUrl.replace(/^https?:\/\//, '');

  const shortUrl = state.code ? `${baseUrl.replace(/\/$/, '')}/${state.code}` : null;
  const routingLocked =
    (mode === 'geo' && !caps.geoRouting) ||
    (mode === 'device' && !caps.deviceRouting) ||
    (mode === 'ab' && !caps.abTesting);

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-6">
        {/* ── Destination (always shown) ─────────────────────────────────── */}
        <div className="space-y-2">
          <Label htmlFor="destination">Destination URL</Label>
          <div className="flex items-center rounded-md border border-input bg-transparent pl-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
            <span className="select-none font-mono text-sm text-muted-foreground">{host}/</span>
            <Input
              id="destination"
              name="destination"
              type="url"
              inputMode="url"
              required
              placeholder="https://example.com/your-long-link"
              className="border-0 bg-transparent font-mono text-sm focus-visible:ring-0"
            />
          </div>
          {mode !== 'single' ? (
            <p className="text-xs text-muted-foreground">
              Used as the fallback when no routing rule below matches.
            </p>
          ) : null}
        </div>

        {/* ── Custom back-half ───────────────────────────────────────────── */}
        <LinkBuilderSection
          title="Custom back-half"
          description="Choose your own short code instead of a random one."
          locked={!caps.customSlugs}
          requiredPlan="Pro"
        >
          <div className="space-y-2">
            <Label htmlFor="customSlug">Back-half</Label>
            <div className="flex items-center gap-2">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{host}/</span>
              <Input
                id="customSlug"
                name="customSlug"
                minLength={4}
                maxLength={32}
                placeholder="my-link"
                className="font-mono text-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Letters, numbers, hyphens, underscores (4–32). Leave blank for a random code.
            </p>
          </div>
        </LinkBuilderSection>

        {/* ── Password ───────────────────────────────────────────────────── */}
        <LinkBuilderSection
          title="Password protection"
          description="Require a password before the link resolves."
          locked={!caps.password}
          requiredPlan="Pro"
        >
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="Set a password"
            />
            <p className="text-xs text-muted-foreground">
              Visitors must enter this before being redirected.
            </p>
          </div>
        </LinkBuilderSection>

        {/* ── Expiry + click limit (both gated by `expiry`) ──────────────── */}
        <LinkBuilderSection
          title="Expiry & limits"
          description="Stop the link after a date or a number of clicks."
          locked={!caps.expiry}
          requiredPlan="Pro"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="expiresAt">Expires at</Label>
              <Input id="expiresAt" name="expiresAt" type="datetime-local" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxClicks">Click limit</Label>
              <Input
                id="maxClicks"
                name="maxClicks"
                type="number"
                min={1}
                step={1}
                placeholder="e.g. 1000"
              />
            </div>
          </div>
        </LinkBuilderSection>

        {/* ── Routing mode + rules ───────────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3">
            <span className="text-sm font-medium text-foreground">Routing</span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Send visitors to different destinations by country, device, or split test.
            </p>
          </div>
          <div className="space-y-4 border-t border-border px-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="routingMode">Mode</Label>
              <select
                id="routingMode"
                name="routingMode"
                value={mode}
                onChange={(e) => setMode(e.target.value as RulesMode)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
              >
                {ROUTING_OPTIONS.map((o) => {
                  const locked = o.feature ? !caps[o.feature] : false;
                  return (
                    <option key={o.value} value={o.value}>
                      {o.label}
                      {locked ? ' (upgrade)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            {routingLocked ? (
              <p className="text-sm text-muted-foreground">
                {mode === 'geo' || mode === 'device'
                  ? 'Geo and device routing are available on the Business plan. '
                  : 'A/B testing is available on the Pro plan. '}
                <Link
                  href="/billing"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Upgrade
                </Link>{' '}
                to unlock.
              </p>
            ) : (
              <LinkBuilderRulesEditor mode={mode} />
            )}
          </div>
        </div>

        {/* ── Campaign assignment ────────────────────────────────────────── */}
        {campaigns.length > 0 ? (
          <LinkBuilderSection
            title="Campaign"
            description="Group this link under a campaign for reporting."
          >
            <div className="space-y-2">
              <Label htmlFor="campaignId">Campaign</Label>
              <select
                id="campaignId"
                name="campaignId"
                defaultValue=""
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
              >
                <option value="">No campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </LinkBuilderSection>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <Button type="submit" disabled={pending || routingLocked}>
            {pending ? (
              <>
                <Spinner /> Creating
              </>
            ) : (
              'Create link'
            )}
          </Button>
          {state.reason === 'plan_required' ? (
            <Link
              href="/billing"
              className="text-sm font-medium text-foreground underline underline-offset-2"
            >
              Upgrade your plan →
            </Link>
          ) : null}
        </div>

        {state.error && !shortUrl ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : null}
      </form>

      {shortUrl ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Your short link is live.</p>
          <CodeBlock value={shortUrl} />
          <p className="text-sm text-muted-foreground">
            <Link href="/links" className="font-medium text-foreground underline underline-offset-2">
              Manage your links →
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}
