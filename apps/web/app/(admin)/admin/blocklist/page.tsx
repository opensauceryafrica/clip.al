import { blockedDomains, db, desc, eq, ilike, users } from '@clipal/db';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { adminBlockDomainAction, adminUnblockDomainAction } from '@/app/(admin)/actions';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin · Blocklist' };
export const dynamic = 'force-dynamic';

export default async function AdminBlocklistPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q = '' } = await searchParams;

  const rows = await db
    .select({
      domain: blockedDomains.domain,
      reason: blockedDomains.reason,
      createdAt: blockedDomains.createdAt,
      addedByEmail: users.email,
    })
    .from(blockedDomains)
    .leftJoin(users, eq(blockedDomains.addedBy, users.id))
    .where(q.trim() ? ilike(blockedDomains.domain, `%${q.trim()}%`) : undefined)
    .orderBy(desc(blockedDomains.createdAt))
    .limit(200);

  return (
    <div>
      <PageHeader title="Blocklist" description="Domains (eTLD+1) refused at submission." />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Block a domain</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={adminBlockDomainAction} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 space-y-1">
              <label htmlFor="domain" className="text-xs text-zinc-500">
                Domain or URL
              </label>
              <Input id="domain" name="domain" required placeholder="example.com" />
            </div>
            <div className="flex-1 space-y-1">
              <label htmlFor="reason" className="text-xs text-zinc-500">
                Reason
              </label>
              <Input id="reason" name="reason" placeholder="phishing" />
            </div>
            <Button type="submit">Block</Button>
          </form>
        </CardContent>
      </Card>

      <form method="get" className="mb-4 flex items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Search domains" className="max-w-xs" />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No blocked domains" />
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Added by</TableHead>
                <TableHead className="text-right">Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.domain}>
                  <TableCell className="font-mono">{row.domain}</TableCell>
                  <TableCell className="text-sm text-zinc-500">{row.reason}</TableCell>
                  <TableCell className="text-xs text-zinc-500">{row.addedByEmail ?? 'seed'}</TableCell>
                  <TableCell className="text-right text-xs text-zinc-500">{formatDate(row.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <form action={adminUnblockDomainAction}>
                      <input type="hidden" name="domain" value={row.domain} />
                      <Button type="submit" variant="ghost" size="sm">
                        Remove
                      </Button>
                    </form>
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
