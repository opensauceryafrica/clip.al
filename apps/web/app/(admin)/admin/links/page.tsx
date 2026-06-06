import { and, db, desc, eq, ilike, links, or, type SQL, users } from '@clipal/db';
import {
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
import { AdminLinkRowActions } from '@/components/admin-link-row-actions';
import { LinkStatusBadge, SafetyBadge } from '@/components/link-status-badge';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatNumber, timeAgo, truncateMiddle } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin · Links' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const STATUSES = [
  'active',
  'disabled_by_user',
  'disabled_by_admin',
  'disabled_by_safety',
  'pending_review',
] as const;
const SAFETY = ['unchecked', 'clean', 'suspicious', 'malicious'] as const;

export default async function AdminLinksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; safety?: string; page?: string }>;
}) {
  await requireAdmin();
  const { q = '', status = '', safety = '', page = '1' } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const conditions: SQL[] = [];
  if (q.trim()) {
    const term = `%${q.trim()}%`;
    const match = or(ilike(links.code, term), ilike(links.destinationUrl, term));
    if (match) conditions.push(match);
  }
  if ((STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(links.status, status as (typeof STATUSES)[number]));
  }
  if ((SAFETY as readonly string[]).includes(safety)) {
    conditions.push(eq(links.safetyState, safety as (typeof SAFETY)[number]));
  }

  const rows = await db
    .select({
      id: links.id,
      code: links.code,
      destinationUrl: links.destinationUrl,
      status: links.status,
      safetyState: links.safetyState,
      clicksTotal: links.clicksTotal,
      reportCount: links.reportCount,
      createdAt: links.createdAt,
      ownerEmail: users.email,
    })
    .from(links)
    .leftJoin(users, eq(links.ownerId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(links.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  return (
    <div>
      <PageHeader title="Links" description="Search and moderate every link on the platform." />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Search code or destination" className="max-w-xs" />
        <select name="status" defaultValue={status} className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select name="safety" defaultValue={safety} className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
          <option value="">All safety</option>
          {SAFETY.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit" className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800">
          Filter
        </button>
      </form>

      {visible.length === 0 ? (
        <EmptyState title="No links found" />
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Safety</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Reports</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((link) => (
                <TableRow key={link.id}>
                  <TableCell className="font-mono">{link.code}</TableCell>
                  <TableCell className="max-w-[14rem] font-mono text-xs text-zinc-500">
                    {truncateMiddle(link.destinationUrl, 40)}
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate text-xs text-zinc-500">
                    {link.ownerEmail ?? 'anonymous'}
                  </TableCell>
                  <TableCell>
                    <LinkStatusBadge status={link.status} />
                  </TableCell>
                  <TableCell>
                    <SafetyBadge state={link.safetyState} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(link.clicksTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{link.reportCount}</TableCell>
                  <TableCell className="text-right text-xs text-zinc-500">{timeAgo(link.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <AdminLinkRowActions linkId={link.id} status={link.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(pageNum > 1 || hasNext) && (
        <div className="mt-4 flex items-center justify-between text-sm">
          {pageNum > 1 ? (
            <Link href={{ pathname: '/admin/links', query: { q, status, safety, page: pageNum - 1 } }} className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link href={{ pathname: '/admin/links', query: { q, status, safety, page: pageNum + 1 } }} className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
