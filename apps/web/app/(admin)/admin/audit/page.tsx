import { and, auditLog, db, desc, eq, ilike, type SQL, users } from '@clipal/db';
import {
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
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin · Audit log' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string; page?: string }>;
}) {
  await requireAdmin();
  const { action = '', actor = '', page = '1' } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const conditions: SQL[] = [];
  if (action.trim()) conditions.push(ilike(auditLog.action, `%${action.trim()}%`));
  if (actor.trim()) conditions.push(ilike(users.email, `%${actor.trim()}%`));

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      createdAt: auditLog.createdAt,
      ip: auditLog.ip,
      actorEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  return (
    <div>
      <PageHeader title="Audit log" description="Every admin action, append-only." />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <Input name="action" defaultValue={action} placeholder="Filter action (e.g. link.disable)" className="max-w-xs" />
        <Input name="actor" defaultValue={actor} placeholder="Actor email" className="max-w-xs" />
        <button type="submit" className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800">
          Filter
        </button>
      </form>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                  {formatDateTime(row.createdAt)}
                </TableCell>
                <TableCell className="text-xs">{row.actorEmail ?? 'system'}</TableCell>
                <TableCell className="font-mono text-xs">{row.action}</TableCell>
                <TableCell className="font-mono text-xs text-zinc-500">
                  {row.targetType === 'link' ? (
                    <Link href={`/admin/links/${row.targetId}`} className="hover:underline">
                      {row.targetType}:{row.targetId.slice(0, 8)}
                    </Link>
                  ) : (
                    `${row.targetType}:${row.targetId}`
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-zinc-500">{row.ip ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {(pageNum > 1 || hasNext) && (
        <div className="mt-4 flex items-center justify-between text-sm">
          {pageNum > 1 ? (
            <Link href={{ pathname: '/admin/audit', query: { action, actor, page: pageNum - 1 } }} className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link href={{ pathname: '/admin/audit', query: { action, actor, page: pageNum + 1 } }} className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50">
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
