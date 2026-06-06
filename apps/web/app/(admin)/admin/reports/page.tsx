import { db, desc, eq, gt, links, users } from '@clipal/db';
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
import { adminDisableLinkAction, adminDismissReportsAction } from '@/app/(admin)/actions';
import { LinkStatusBadge } from '@/components/link-status-badge';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatNumber, truncateMiddle } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin · Reports' };
export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  await requireAdmin();

  const rows = await db
    .select({
      id: links.id,
      code: links.code,
      destinationUrl: links.destinationUrl,
      status: links.status,
      reportCount: links.reportCount,
      ownerEmail: users.email,
    })
    .from(links)
    .leftJoin(users, eq(links.ownerId, users.id))
    .where(gt(links.reportCount, 0))
    .orderBy(desc(links.reportCount))
    .limit(100);

  return (
    <div>
      <PageHeader title="Reports" description="Links with open abuse reports, most-reported first." />

      {rows.length === 0 ? (
        <EmptyState title="No open reports" description="The abuse queue is clear." />
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Reports</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((link) => (
                <TableRow key={link.id}>
                  <TableCell>
                    <Link href={`/admin/links/${link.id}`} className="font-mono hover:underline">
                      {link.code}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[16rem] font-mono text-xs text-zinc-500">
                    {truncateMiddle(link.destinationUrl, 44)}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500">{link.ownerEmail ?? 'anonymous'}</TableCell>
                  <TableCell>
                    <LinkStatusBadge status={link.status} />
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatNumber(link.reportCount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {link.status === 'active' ? (
                        <form action={adminDisableLinkAction}>
                          <input type="hidden" name="linkId" value={link.id} />
                          <Button type="submit" variant="ghost" size="sm" className="text-red-600">
                            Disable
                          </Button>
                        </form>
                      ) : null}
                      <form action={adminDismissReportsAction}>
                        <input type="hidden" name="linkId" value={link.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Dismiss
                        </Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
