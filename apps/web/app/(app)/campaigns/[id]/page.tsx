import { campaignClicksByCode } from '@clipal/ch';
import {
  and,
  asc,
  campaigns,
  db,
  desc,
  eq,
  inArray,
  linkDestinations,
  links,
} from '@clipal/db';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@clipal/ui';
import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { requireUser } from '@/lib/auth';
import { formatDate, formatNumber } from '@/lib/format';
import { CampaignDetailActions } from './campaign-detail-actions';

export const metadata: Metadata = { title: 'Campaign' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;

  // Own-the-campaign guard.
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, user.id)))
    .limit(1);
  if (!campaign) notFound();

  // The campaign's links (denormalized clicksTotal is the always-available count;
  // CH gives a fresher 30-day, renames-spanning figure below).
  const linkRows = await db
    .select({
      id: links.id,
      code: links.code,
      previousCodes: links.previousCodes,
      destinationUrl: links.destinationUrl,
      routingMode: links.routingMode,
      clicksTotal: links.clicksTotal,
      createdAt: links.createdAt,
    })
    .from(links)
    .where(and(eq(links.campaignId, id), eq(links.ownerId, user.id)))
    .orderBy(desc(links.createdAt));

  // A/B variants (and their weights) for every A/B link in one query.
  const abLinkIds = linkRows.filter((l) => l.routingMode === 'ab').map((l) => l.id);
  const destinationRows =
    abLinkIds.length > 0
      ? await db
          .select({
            linkId: linkDestinations.linkId,
            match: linkDestinations.match,
            destinationUrl: linkDestinations.destinationUrl,
            order: linkDestinations.order,
          })
          .from(linkDestinations)
          .where(inArray(linkDestinations.linkId, abLinkIds))
          .orderBy(asc(linkDestinations.order))
      : [];

  const variantsByLink = new Map<string, { url: string; weight: number }[]>();
  for (const row of destinationRows) {
    const weight = row.match.type === 'ab' ? row.match.weight : 0;
    const list = variantsByLink.get(row.linkId) ?? [];
    list.push({ url: row.destinationUrl, weight });
    variantsByLink.set(row.linkId, list);
  }

  // ClickHouse 30-day human totals, keyed by code. A link may own several codes
  // (renames), so sum every code that belongs to it. Best-effort: a CH blip
  // falls back to the denormalized links.clicksTotal in the table below.
  const allCodes = linkRows.flatMap((l) => [l.code, ...l.previousCodes]);
  const chRows = await safe(campaignClicksByCode(allCodes, 30), []);
  const clicksByCode = new Map(chRows.map((r) => [r.name, Number(r.clicks) || 0]));
  const recentClicksByLink = new Map<string, number>(
    linkRows.map((l) => [
      l.id,
      [l.code, ...l.previousCodes].reduce((sum, c) => sum + (clicksByCode.get(c) ?? 0), 0),
    ]),
  );

  return (
    <div>
      <PageHeader
        title={campaign.name}
        description="Campaign links and A/B variants"
        action={
          <CampaignDetailActions
            campaignId={campaign.id}
            name={campaign.name}
            notes={campaign.notes ?? ''}
            linkCount={linkRows.length}
          />
        }
      />

      <p className="mb-6 text-sm text-muted-foreground">
        <Link href="/campaigns" className="underline-offset-4 hover:underline">
          ← All campaigns
        </Link>
      </p>

      {error === 'has_links' ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          This campaign still has links assigned. Use “Delete” and confirm “Detach &amp; delete” to
          remove it.
        </div>
      ) : null}

      {campaign.notes ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{campaign.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Phase-3 attribution caveat — surfaced prominently because the variant
          rows below show per-LINK clicks, not per-variant. */}
      <div className="mb-6 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          A/B numbers below are <span className="font-medium text-foreground">per-link</span>{' '}
          totals. True per-variant click attribution is planned for Phase 3 — the click event does
          not yet record which served variant a visitor saw, so individual variant click counts
          aren’t available. Weights show the configured traffic split.
        </p>
      </div>

      {linkRows.length === 0 ? (
        <EmptyState
          title="No links in this campaign"
          description="Assign links to this campaign from a link’s detail page to start tracking them here."
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Link</TableHead>
                <TableHead>Routing</TableHead>
                <TableHead className="text-right">Clicks · 30d</TableHead>
                <TableHead className="text-right">Total clicks</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linkRows.map((l) => {
                const variants = variantsByLink.get(l.id) ?? [];
                const weightTotal = variants.reduce((s, v) => s + v.weight, 0);
                return (
                  <TableRow key={l.id} className="align-top">
                    <TableCell>
                      <Link
                        href={`/links/${l.id}`}
                        className="font-mono text-sm font-medium hover:underline"
                      >
                        /{l.code}
                      </Link>
                      <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">
                        {l.destinationUrl}
                      </p>
                      {l.routingMode === 'ab' && variants.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {variants.map((v, i) => {
                            const pct =
                              weightTotal > 0 ? Math.round((v.weight / weightTotal) * 100) : 0;
                            return (
                              <li
                                key={i}
                                className="flex items-center gap-2 text-xs text-muted-foreground"
                              >
                                <Badge>{pct}%</Badge>
                                <span className="max-w-xs truncate font-mono">{v.url}</span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={l.routingMode === 'ab' ? 'active' : 'neutral'}>
                        {l.routingMode === 'ab' ? 'A/B test' : l.routingMode}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatNumber(recentClicksByLink.get(l.id) ?? 0)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {formatNumber(l.clicksTotal)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatDate(l.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
