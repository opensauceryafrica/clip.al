import { env } from '@clipal/config';
import { adsPlacements, asc, db, desc } from '@clipal/db';
import { publicUrl } from '@clipal/s3';
import {
  Badge,
  Button,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@clipal/ui';
import type { Metadata } from 'next';
import { Pencil, Trash2 } from 'lucide-react';
import {
  deleteAdPlacementAction,
  toggleAdPlacementAction,
} from '@/app/(admin)/actions';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import { AdFormDialog, type AdFormDefaults, type AdSlot } from './ad-form-dialog';

export const metadata: Metadata = { title: 'Admin · Ads' };
export const dynamic = 'force-dynamic';

const SLOT_LABEL: Record<AdSlot, string> = {
  interstitial_top: 'Interstitial — top',
  interstitial_bottom: 'Interstitial — bottom',
  tree_top: 'Link tree — top',
};

// Stable display order for the slot groups.
const SLOT_ORDER: readonly AdSlot[] = [
  'interstitial_top',
  'interstitial_bottom',
  'tree_top',
];

/** Format a Date into the `YYYY-MM-DDTHH:mm` shape a datetime-local input wants. */
function toLocalInput(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** Human window summary for the table (start → end), or "Always" when open-ended. */
function windowLabel(startsAt: Date | null, endsAt: Date | null): string {
  if (!startsAt && !endsAt) return 'Always';
  const start = startsAt ? formatDateTime(startsAt) : '—';
  const end = endsAt ? formatDateTime(endsAt) : '∞';
  return `${start} → ${end}`;
}

function ctr(impressions: number, clicks: number): string {
  if (impressions <= 0) return '—';
  return `${((clicks / impressions) * 100).toFixed(2)}%`;
}

export default async function AdminAdsPage() {
  await requireAdmin();

  const rows = await db
    .select()
    .from(adsPlacements)
    .orderBy(asc(adsPlacements.slot), desc(adsPlacements.weight), desc(adsPlacements.createdAt));

  const bySlot = new Map<AdSlot, typeof rows>();
  for (const slot of SLOT_ORDER) bySlot.set(slot, []);
  for (const row of rows) {
    const slot = row.slot as AdSlot;
    const list = bySlot.get(slot);
    if (list) list.push(row);
  }

  return (
    <div>
      <PageHeader
        title="Ads"
        description="House ad placements served in the named slots. Selection is weighted-random over the active placements for each slot during their scheduled window."
        action={<AdFormDialog />}
      />

      {!env.ADS_ENABLED ? (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          Ad serving is disabled (<code className="font-mono">ADS_ENABLED</code> is off). These
          placements are managed here but will not render to visitors until ads are enabled
          {env.ADSENSE_CLIENT_ID ? '' : ' and an AdSense client id is configured'}.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No ad placements yet"
          description="Create a placement to start serving house ads in the interstitial and link-tree slots."
        />
      ) : (
        <div className="space-y-8">
          {SLOT_ORDER.map((slot) => {
            const list = bySlot.get(slot) ?? [];
            return (
              <section key={slot}>
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{SLOT_LABEL[slot]}</h2>
                  <Badge variant="neutral">{list.length}</Badge>
                </div>

                {list.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    No placements in this slot.
                  </p>
                ) : (
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Advertiser</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Weight</TableHead>
                          <TableHead>Window</TableHead>
                          <TableHead className="text-right">Impressions</TableHead>
                          <TableHead className="text-right">Clicks</TableHead>
                          <TableHead className="text-right">CTR</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.map((row) => {
                          const defaults: AdFormDefaults = {
                            id: row.id,
                            slot: row.slot as AdSlot,
                            advertiserName: row.advertiserName,
                            clickUrl: row.clickUrl,
                            weight: row.weight,
                            active: row.active,
                            startsAt: toLocalInput(row.startsAt),
                            endsAt: toLocalInput(row.endsAt),
                            imagePreviewUrl: publicUrl(row.imageUrl),
                          };
                          return (
                            <TableRow key={row.id}>
                              <TableCell>
                                <div className="flex items-center gap-3">
                                  <span className="size-9 shrink-0 overflow-hidden rounded border border-border bg-muted">
                                    <img
                                      src={publicUrl(row.imageUrl)}
                                      alt=""
                                      className="size-full object-cover"
                                    />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="truncate font-medium text-foreground">
                                      {row.advertiserName}
                                    </div>
                                    <a
                                      href={row.clickUrl}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="block truncate text-xs text-muted-foreground hover:underline"
                                    >
                                      {row.clickUrl}
                                    </a>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={row.active ? 'active' : 'disabled'}>
                                  {row.active ? 'active' : 'paused'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{row.weight}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {windowLabel(row.startsAt, row.endsAt)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatNumber(row.impressions)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatNumber(row.clicks)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {ctr(row.impressions, row.clicks)}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center justify-end gap-1">
                                  <AdFormDialog
                                    defaults={defaults}
                                    trigger={
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        aria-label="Edit placement"
                                      >
                                        <Pencil className="size-4" />
                                      </Button>
                                    }
                                  />
                                  <form action={toggleAdPlacementAction}>
                                    <input type="hidden" name="id" value={row.id} />
                                    <input
                                      type="hidden"
                                      name="active"
                                      value={row.active ? 'false' : 'true'}
                                    />
                                    <Button type="submit" variant="ghost" size="sm">
                                      {row.active ? 'Deactivate' : 'Activate'}
                                    </Button>
                                  </form>
                                  <form action={deleteAdPlacementAction}>
                                    <input type="hidden" name="id" value={row.id} />
                                    <Button
                                      type="submit"
                                      variant="ghost"
                                      size="sm"
                                      aria-label="Delete placement"
                                      className="text-destructive hover:text-destructive"
                                    >
                                      <Trash2 className="size-4" />
                                    </Button>
                                  </form>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
