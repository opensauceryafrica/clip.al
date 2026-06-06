import { and, db, desc, eq, ilike, links, or, type SQL } from '@clipal/db';
import {
  Button,
  EmptyState,
  Input,
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
import { requireUser } from '@/lib/auth';
import { formatNumber, timeAgo, truncateMiddle } from '@/lib/format';

export const metadata: Metadata = { title: 'Links' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const STATUSES = [
  'active',
  'disabled_by_user',
  'disabled_by_admin',
  'disabled_by_safety',
  'pending_review',
] as const;
type LinkStatus = (typeof STATUSES)[number];

function isStatus(value: string): value is LinkStatus {
  return (STATUSES as readonly string[]).includes(value);
}

export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const user = await requireUser();
  const { q = '', status = '', page = '1' } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const conditions: SQL[] = [eq(links.ownerId, user.id)];
  if (q.trim()) {
    const term = `%${q.trim()}%`;
    const match = or(ilike(links.code, term), ilike(links.destinationUrl, term));
    if (match) conditions.push(match);
  }
  if (status && isStatus(status)) conditions.push(eq(links.status, status));

  const rows = await db
    .select({
      id: links.id,
      code: links.code,
      destinationUrl: links.destinationUrl,
      status: links.status,
      clicksTotal: links.clicksTotal,
      createdAt: links.createdAt,
    })
    .from(links)
    .where(and(...conditions))
    .orderBy(desc(links.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Links"
        action={
          <Button asChild size="sm">
            <Link href="/">New link</Link>
          </Button>
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search code or destination"
          className="max-w-xs"
          aria-label="Search links"
        />
        <select
          name="status"
          defaultValue={status}
          aria-label="Filter by status"
          className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 focus-visible:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
      </form>

      {visible.length === 0 ? (
        <EmptyState title="No links found" description="Try a different search or status filter." />
      ) : (
        <>
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
                {visible.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell>
                      <Link
                        href={`/links/${link.id}`}
                        className="font-mono text-zinc-950 hover:underline dark:text-zinc-50"
                      >
                        {link.code}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-sm">
                      <span className="font-mono text-xs text-zinc-500">
                        {truncateMiddle(link.destinationUrl, 56)}
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

          {(pageNum > 1 || hasNext) && (
            <div className="mt-4 flex items-center justify-between text-sm">
              {pageNum > 1 ? (
                <Link
                  href={{ pathname: '/links', query: { q, status, page: pageNum - 1 } }}
                  className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              {hasNext ? (
                <Link
                  href={{ pathname: '/links', query: { q, status, page: pageNum + 1 } }}
                  className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
