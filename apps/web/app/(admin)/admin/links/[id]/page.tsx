import { linkRecentClicks } from '@clipal/ch';
import { db, desc, eq, linkReports, links, users } from '@clipal/db';
import {
  Button,
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
import { adminDisableLinkAction, adminSetSafetyAction } from '@/app/(admin)/actions';
import { LinkStatusBadge, SafetyBadge } from '@/components/link-status-badge';
import { PageHeader } from '@/components/page-header';
import { getPublicBaseUrl } from '@clipal/config';
import { requireAdmin } from '@/lib/auth';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin · Link' };
export const dynamic = 'force-dynamic';

export default async function AdminLinkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const [link] = await db
    .select({
      id: links.id,
      code: links.code,
      destinationUrl: links.destinationUrl,
      status: links.status,
      safetyState: links.safetyState,
      safetyThreats: links.safetyThreats,
      clicksTotal: links.clicksTotal,
      reportCount: links.reportCount,
      createdAt: links.createdAt,
      creatorIp: links.creatorIp,
      ownerEmail: users.email,
    })
    .from(links)
    .leftJoin(users, eq(links.ownerId, users.id))
    .where(eq(links.id, id))
    .limit(1);
  if (!link) notFound();

  const [reports, recent] = await Promise.all([
    db
      .select()
      .from(linkReports)
      .where(eq(linkReports.linkId, id))
      .orderBy(desc(linkReports.createdAt))
      .limit(50),
    linkRecentClicks(link.code, 50).catch(() => []),
  ]);

  return (
    <div>
      <PageHeader
        title={link.code}
        description="Admin link detail"
        action={
          <div className="flex items-center gap-1">
            {link.status === 'active' ? (
              <form action={adminDisableLinkAction}>
                <input type="hidden" name="linkId" value={link.id} />
                <Button type="submit" variant="secondary" size="sm">
                  Disable
                </Button>
              </form>
            ) : null}
            <form action={adminSetSafetyAction}>
              <input type="hidden" name="linkId" value={link.id} />
              <input type="hidden" name="state" value="clean" />
              <Button type="submit" variant="ghost" size="sm">
                Mark safe
              </Button>
            </form>
            <form action={adminSetSafetyAction}>
              <input type="hidden" name="linkId" value={link.id} />
              <input type="hidden" name="state" value="malicious" />
              <Button type="submit" variant="ghost" size="sm" className="text-red-600">
                Mark malicious
              </Button>
            </form>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CodeBlock value={`${getPublicBaseUrl()}/${link.code}`} />
            <p className="break-all font-mono text-xs text-zinc-500">{link.destinationUrl}</p>
            <KeyValue>
              <KeyValueRow label="Owner">{link.ownerEmail ?? 'anonymous'}</KeyValueRow>
              <KeyValueRow label="Status">
                <LinkStatusBadge status={link.status} />
              </KeyValueRow>
              <KeyValueRow label="Safety">
                <SafetyBadge state={link.safetyState} />
              </KeyValueRow>
              <KeyValueRow label="Threats">
                {link.safetyThreats?.length ? link.safetyThreats.join(', ') : '—'}
              </KeyValueRow>
              <KeyValueRow label="Clicks">{formatNumber(link.clicksTotal)}</KeyValueRow>
              <KeyValueRow label="Reports">{link.reportCount}</KeyValueRow>
              <KeyValueRow label="Creator IP">{link.creatorIp ?? '—'}</KeyValueRow>
              <KeyValueRow label="Created">{formatDate(link.createdAt)}</KeyValueRow>
            </KeyValue>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reports ({reports.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {reports.length === 0 ? (
              <p className="text-sm text-zinc-500">No reports.</p>
            ) : (
              <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                {reports.map((r) => (
                  <li key={r.id} className="py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize text-zinc-950 dark:text-zinc-50">
                        {r.reason}
                      </span>
                      <span className="text-xs text-zinc-500">{formatDateTime(r.createdAt)}</span>
                    </div>
                    {r.note ? <p className="mt-1 text-zinc-600 dark:text-zinc-400">{r.note}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-zinc-950 dark:text-zinc-50">Recent clicks</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-500">No clicks recorded.</p>
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
                    <TableCell className="text-sm capitalize">{click.device}</TableCell>
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
