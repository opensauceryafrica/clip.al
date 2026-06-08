import { ownerClicksToday } from '@clipal/ch';
import { count, db, desc, eq, links, sql } from '@clipal/db';
import {
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
import Link from 'next/link';
import { LinkStatusBadge } from '@/components/link-status-badge';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { requireUser } from '@/lib/auth';
import { formatNumber, timeAgo, truncateMiddle } from '@/lib/format';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const user = await requireUser();
  const { welcome } = await searchParams;

  const [recent, statsRows, topRows, todayClicks] = await Promise.all([
    db
      .select({
        id: links.id,
        code: links.code,
        destinationUrl: links.destinationUrl,
        status: links.status,
        clicksTotal: links.clicksTotal,
        createdAt: links.createdAt,
      })
      .from(links)
      .where(eq(links.ownerId, user.id))
      .orderBy(desc(links.createdAt))
      .limit(8),
    db
      .select({
        totalLinks: count(),
        totalClicks: sql<string>`coalesce(sum(${links.clicksTotal}), 0)`,
      })
      .from(links)
      .where(eq(links.ownerId, user.id)),
    db
      .select({ code: links.code, clicks: links.clicksTotal })
      .from(links)
      .where(eq(links.ownerId, user.id))
      .orderBy(desc(links.clicksTotal))
      .limit(1),
    ownerClicksToday(user.id).catch(() => 0),
  ]);

  const stats = statsRows[0] ?? { totalLinks: 0, totalClicks: '0' };
  const top = topRows[0];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={welcome === 'back' ? 'Welcome back — your clip.al account is ready.' : undefined}
        action={
          <Button asChild size="sm">
            <Link href="/links/new">New link</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Clicks today" value={formatNumber(todayClicks)} />
        <StatCard label="Total links" value={formatNumber(stats.totalLinks)} />
        <StatCard label="Total clicks" value={formatNumber(Number(stats.totalClicks))} />
        <StatCard
          label="Top link"
          value={top ? <span className="font-mono text-xl">{top.code}</span> : '—'}
          hint={top ? `${formatNumber(top.clicks)} clicks` : 'No clicks yet'}
        />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-950 dark:text-zinc-50">Recent links</h2>
          <Link href="/links" className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50">
            View all
          </Link>
        </div>

        {recent.length === 0 ? (
          <EmptyState
            title="No links yet"
            description="Shorten your first link to see it here."
            action={
              <Button asChild size="sm">
                <Link href="/links/new">Create a link</Link>
              </Button>
            }
          />
        ) : (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell>
                      <Link
                        href={`/links/${link.id}`}
                        className="font-mono text-zinc-950 hover:underline dark:text-zinc-50"
                      >
                        {link.code}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="font-mono text-xs text-zinc-500">
                        {truncateMiddle(link.destinationUrl, 48)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <LinkStatusBadge status={link.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(link.clicksTotal)}
                    </TableCell>
                    <TableCell className="text-right text-xs text-zinc-500">
                      {timeAgo(link.createdAt)}
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
