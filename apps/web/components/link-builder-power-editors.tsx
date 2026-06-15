'use client';

import { Badge, Button, Input, Label, Spinner } from '@clipal/ui';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  assignLinkCampaignAction,
  removeLinkPasswordAction,
  setLinkExpiryAction,
  setLinkMaxClicksAction,
  setLinkPasswordAction,
  setLinkRoutingAction,
} from '@/app/(app)/links/[id]/actions';
import type { FormActionState } from '@/lib/action-state';
import {
  LinkBuilderRulesEditor,
  type InitialRule,
  type RulesMode,
} from './link-builder-rules-editor';

const initial: FormActionState = {};

/** Inline success/error line shared by the editors. */
function StatusLine({ state, okLabel }: { state: FormActionState; okLabel: string }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-emerald-600">{okLabel}</p>;
  return null;
}

/** Small lock hint for features the plan doesn't include. */
function PlanLock({ plan }: { plan: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      Available on the {plan} plan.{' '}
      <Link href="/billing" className="font-medium text-foreground underline underline-offset-2">
        Upgrade
      </Link>{' '}
      to use this.
    </p>
  );
}

// ── Password ─────────────────────────────────────────────────────────────────

export function LinkBuilderPasswordEditor({
  linkId,
  hasPassword,
  allowed,
}: {
  linkId: string;
  hasPassword: boolean;
  allowed: boolean;
}) {
  const [setState, setAction, setting] = useActionState(setLinkPasswordAction, initial);
  const [removeState, removeAction, removing] = useActionState(removeLinkPasswordAction, initial);

  if (!allowed && !hasPassword) return <PlanLock plan="Pro" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant={hasPassword ? 'active' : 'disabled'}>
          {hasPassword ? 'Password set' : 'No password'}
        </Badge>
      </div>
      <form action={setAction} className="space-y-2">
        <input type="hidden" name="linkId" value={linkId} />
        <Label htmlFor="pw-set" className="text-xs">
          {hasPassword ? 'Rotate password' : 'Set password'}
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="pw-set"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            placeholder="New password"
            className="flex-1"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={setting}>
            {setting ? 'Saving…' : hasPassword ? 'Rotate' : 'Set'}
          </Button>
        </div>
        <StatusLine state={setState} okLabel="Password updated." />
      </form>
      {hasPassword ? (
        <form action={removeAction}>
          <input type="hidden" name="linkId" value={linkId} />
          <Button type="submit" variant="ghost" size="sm" disabled={removing}>
            {removing ? 'Removing…' : 'Remove password'}
          </Button>
          <StatusLine state={removeState} okLabel="Password removed." />
        </form>
      ) : null}
    </div>
  );
}

// ── Expiry ───────────────────────────────────────────────────────────────────

/** ISO/Date → value for <input type="datetime-local"> (local, no seconds). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LinkBuilderExpiryEditor({
  linkId,
  expiresAt,
  allowed,
}: {
  linkId: string;
  expiresAt: string | null;
  allowed: boolean;
}) {
  const [state, action, pending] = useActionState(setLinkExpiryAction, initial);

  if (!allowed && !expiresAt) return <PlanLock plan="Pro" />;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="linkId" value={linkId} />
      <Label htmlFor="expiresAt" className="text-xs">
        Expires at
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="expiresAt"
          name="expiresAt"
          type="datetime-local"
          defaultValue={toLocalInput(expiresAt)}
          className="flex-1"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Leave blank to clear the expiry.</p>
      <StatusLine state={state} okLabel="Expiry updated." />
    </form>
  );
}

// ── Click limit ──────────────────────────────────────────────────────────────

export function LinkBuilderMaxClicksEditor({
  linkId,
  maxClicks,
  allowed,
}: {
  linkId: string;
  maxClicks: number | null;
  allowed: boolean;
}) {
  const [state, action, pending] = useActionState(setLinkMaxClicksAction, initial);

  if (!allowed && maxClicks === null) return <PlanLock plan="Pro" />;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="linkId" value={linkId} />
      <Label htmlFor="maxClicks" className="text-xs">
        Click limit
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="maxClicks"
          name="maxClicks"
          type="number"
          min={1}
          step={1}
          defaultValue={maxClicks ?? ''}
          placeholder="Unlimited"
          className="flex-1"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Leave blank for unlimited clicks.</p>
      <StatusLine state={state} okLabel="Click limit updated." />
    </form>
  );
}

// ── Routing ──────────────────────────────────────────────────────────────────

export interface RoutingCaps {
  geoRouting: boolean;
  deviceRouting: boolean;
  abTesting: boolean;
}

export function LinkBuilderRoutingEditor({
  linkId,
  routingMode,
  rules,
  caps,
}: {
  linkId: string;
  routingMode: RulesMode;
  rules: InitialRule[];
  caps: RoutingCaps;
}) {
  const [state, action, pending] = useActionState(setLinkRoutingAction, initial);
  const [mode, setMode] = useState<RulesMode>(routingMode);

  const options: { value: RulesMode; label: string; feature?: keyof RoutingCaps }[] = [
    { value: 'single', label: 'Single destination' },
    { value: 'geo', label: 'Geo routing', feature: 'geoRouting' },
    { value: 'device', label: 'Device routing', feature: 'deviceRouting' },
    { value: 'ab', label: 'A/B testing', feature: 'abTesting' },
  ];

  const locked =
    (mode === 'geo' && !caps.geoRouting) ||
    (mode === 'device' && !caps.deviceRouting) ||
    (mode === 'ab' && !caps.abTesting);

  // Preserve the saved rules only while the mode is unchanged; switching modes
  // starts from an empty editor (the match shapes differ per mode).
  const initialRules = mode === routingMode ? rules : undefined;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="linkId" value={linkId} />
      <input type="hidden" name="routingMode" value={mode} />
      <div className="space-y-2">
        <Label htmlFor="routing-mode" className="text-xs">
          Mode
        </Label>
        <select
          id="routing-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as RulesMode)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
        >
          {options.map((o) => {
            const optLocked = o.feature ? !caps[o.feature] : false;
            return (
              <option key={o.value} value={o.value}>
                {o.label}
                {optLocked ? ' (upgrade)' : ''}
              </option>
            );
          })}
        </select>
      </div>

      {/* key forces a fresh editor (clearing rows) when the mode changes. */}
      <LinkBuilderRulesEditor
        key={mode}
        mode={mode}
        {...(initialRules ? { initial: initialRules } : {})}
      />

      {locked ? (
        <p className="text-sm text-muted-foreground">
          {mode === 'ab' ? 'A/B testing is on the Pro plan. ' : 'This routing is on the Business plan. '}
          <Link href="/billing" className="font-medium text-foreground underline underline-offset-2">
            Upgrade
          </Link>{' '}
          to use it.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" disabled={pending || locked}>
          {pending ? (
            <>
              <Spinner /> Saving
            </>
          ) : (
            'Save routing'
          )}
        </Button>
      </div>
      <StatusLine state={state} okLabel="Routing updated." />
    </form>
  );
}

// ── Campaign ─────────────────────────────────────────────────────────────────

export function LinkBuilderCampaignEditor({
  linkId,
  campaignId,
  campaigns,
}: {
  linkId: string;
  campaignId: string | null;
  campaigns: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(assignLinkCampaignAction, initial);

  if (campaigns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No campaigns yet.{' '}
        <Link
          href="/campaigns"
          className="font-medium text-foreground underline underline-offset-2"
        >
          Create one
        </Link>{' '}
        to group links.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="linkId" value={linkId} />
      <Label htmlFor="campaignId" className="text-xs">
        Campaign
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          id="campaignId"
          name="campaignId"
          defaultValue={campaignId ?? ''}
          className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
        >
          <option value="">No campaign</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <StatusLine state={state} okLabel="Campaign updated." />
    </form>
  );
}
