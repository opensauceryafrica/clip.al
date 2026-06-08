import {
  linkClicksByDay,
  linkDevices,
  linkRecentClicks,
  linkTopCountries,
  linkTopReferrers,
  type DailyClicks,
} from '@clipal/ch';
import { getPublicBaseUrl } from '@clipal/config';
import { and, db, eq, links } from '@clipal/db';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CodeBlock,
  KeyValue,
  KeyValueRow,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@clipal/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BarChart, type BarPoint } from '@/components/bar-chart';
import { EditDestinationForm } from '@/components/edit-destination-form';
import { EditSlugForm } from '@/components/edit-slug-form';
import { LinkDetailActions } from '@/components/link-detail-actions';
import { LinkStatusBadge, SafetyBadge } from '@/components/link-status-badge';
import { PageHeader } from '@/components/page-header';
import { RankedList } from '@/components/ranked-list';
import { requireUser } from '@/lib/auth';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Link' };
export const dynamic = 'force-dynamic';

function buildDailyPoints(rows: DailyClicks[], days = 30): BarPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r.clicks]));
  const points: BarPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    points.push({ label: key, value: byDay.get(key) ?? 0 });
  }
  return points;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export default async function LinkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const [link] = await db
    .select()
    .from(links)
    .where(and(eq(links.id, id), eq(links.ownerId, user.id)))
    .limit(1);
  if (!link) notFound();

  // Analytics span the current back-half plus any previous ones (renames keep
  // their history) — ClickHouse is keyed by link_code.
  const codes = [link.code, ...link.previousCodes];
  const [daily, countries, referrers, devices, recent] = await Promise.all([
    safe(linkClicksByDay(codes, 30), []),
    safe(linkTopCountries(codes, 30, 8), []),
    safe(linkTopReferrers(codes, 30, 8), []),
    safe(linkDevices(codes, 30), []),
    safe(linkRecentClicks(codes, 100), []),
  ]);

  const shortUrl = `${getPublicBaseUrl()}/${link.code}`;

  return (
    <div>
      <PageHeader
        title={link.code}
        description="Link details and analytics"
        action={<LinkDetailActions linkId={link.id} status={link.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <CodeBlock value={shortUrl} />
            <div>
              <p className="mb-2 text-xs text-zinc-500">Back-half</p>
              <EditSlugForm linkId={link.id} code={link.code} baseUrl={getPublicBaseUrl()} />
            </div>
            <div>
              <p className="mb-2 text-xs text-zinc-500">Destination</p>
              <EditDestinationForm linkId={link.id} destination={link.destinationUrl} />
            </div>
            <KeyValue>
              <KeyValueRow label="Status">
                <LinkStatusBadge status={link.status} />
              </KeyValueRow>
              <KeyValueRow label="Safety">
                <SafetyBadge state={link.safetyState} />
              </KeyValueRow>
              <KeyValueRow label="Total clicks">{formatNumber(link.clicksTotal)}</KeyValueRow>
              <KeyValueRow label="Last click">
                {link.lastClickAt ? formatDateTime(link.lastClickAt) : 'Never'}
              </KeyValueRow>
              <KeyValueRow label="Created">{formatDate(link.createdAt)}</KeyValueRow>
              {link.previousCodes.length > 0 ? (
                <KeyValueRow label="Old back-halves">
                  <span className="font-mono text-xs text-muted-foreground">
                    {link.previousCodes.join(', ')}
                  </span>
                </KeyValueRow>
              ) : null}
            </KeyValue>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clicks · last 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart points={buildDailyPoints(daily)} />
            <p className="mt-2 text-xs text-zinc-500">
              {formatNumber(daily.reduce((a, d) => a + d.clicks, 0))} clicks in 30 days
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <RankedList title="Top countries" items={countries} />
        <RankedList title="Top referrers" items={referrers} />
        <RankedList title="Devices" items={devices} />
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-zinc-950 dark:text-zinc-50">Recent clicks</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-500">No clicks recorded yet.</p>
        ) : (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Referrer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((click, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                      {formatDateTime(`${click.ts.replace(' ', 'T')}Z`)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {[click.city, click.country].filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {click.device}
                      {click.is_bot ? <span className="ml-1 text-xs text-zinc-400">(bot)</span> : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-500">
                      {click.referrer_host || 'direct'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
