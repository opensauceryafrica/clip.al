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
import { adminAddBlockEntryAction, adminRemoveBlockEntryAction } from '@/app/(admin)/actions';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin · Blocklist' };
export const dynamic = 'force-dynamic';

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none';

export default async function AdminBlocklistPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q = '' } = await searchParams;

  const rows = await db
    .select({
      value: blockedDomains.domain,
      match: blockedDomains.match,
      policy: blockedDomains.policy,
      reason: blockedDomains.reason,
      createdAt: blockedDomains.createdAt,
      addedByEmail: users.email,
    })
    .from(blockedDomains)
    .leftJoin(users, eq(blockedDomains.addedBy, users.id))
    .where(q.trim() ? ilike(blockedDomains.domain, `%${q.trim()}%`) : undefined)
    .orderBy(desc(blockedDomains.createdAt))
    .limit(500);

  return (
    <div>
      <PageHeader
        title="Blocklist"
        description="Domains (exact eTLD+1) and keywords (substring of the destination host). Block = refused at submission; Flag = allowed but queued for review."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add an entry</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={adminAddBlockEntryAction} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 space-y-1">
              <label htmlFor="value" className="text-xs text-muted-foreground">
                Value (domain or keyword)
              </label>
              <Input id="value" name="value" required placeholder="example.com or paypal" />
            </div>
            <div className="space-y-1">
              <label htmlFor="match" className="text-xs text-muted-foreground">
                Match
              </label>
              <select id="match" name="match" defaultValue="domain" className={SELECT_CLASS}>
                <option value="domain">Domain (exact)</option>
                <option value="keyword">Keyword (substring)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="policy" className="text-xs text-muted-foreground">
                Policy
              </label>
              <select id="policy" name="policy" defaultValue="reject" className={SELECT_CLASS}>
                <option value="reject">Block</option>
                <option value="flag">Flag</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="reason" className="text-xs text-muted-foreground">
                Reason
              </label>
              <Input id="reason" name="reason" placeholder="phishing" />
            </div>
            <Button type="submit">Add</Button>
          </form>
        </CardContent>
      </Card>

      <form method="get" className="mb-4 flex items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Search blocklist" className="max-w-xs" />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Blocklist is empty" />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Value</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Added by</TableHead>
                <TableHead className="text-right">Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.match}:${row.value}`}>
                  <TableCell className="font-mono">{row.value}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.match}</TableCell>
                  <TableCell className="text-sm">
                    <span
                      className={
                        row.policy === 'reject'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }
                    >
                      {row.policy === 'reject' ? 'block' : 'flag'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.reason}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.addedByEmail ?? 'seed'}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {formatDate(row.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <form action={adminRemoveBlockEntryAction}>
                      <input type="hidden" name="value" value={row.value} />
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
