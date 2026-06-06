import { desc, eq, flaggedBrandTerms, ilike, users, db } from '@clipal/db';
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
import { adminAddBrandTermAction, adminRemoveBrandTermAction } from '@/app/(admin)/actions';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin · Brand terms' };
export const dynamic = 'force-dynamic';

export default async function AdminBrandTermsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q = '' } = await searchParams;

  const rows = await db
    .select({
      term: flaggedBrandTerms.term,
      policy: flaggedBrandTerms.policy,
      createdAt: flaggedBrandTerms.createdAt,
      addedByEmail: users.email,
    })
    .from(flaggedBrandTerms)
    .leftJoin(users, eq(flaggedBrandTerms.addedBy, users.id))
    .where(q.trim() ? ilike(flaggedBrandTerms.term, `%${q.trim()}%`) : undefined)
    .orderBy(desc(flaggedBrandTerms.createdAt))
    .limit(500);

  return (
    <div>
      <PageHeader
        title="Brand terms"
        description="Trademark lookalike terms checked against destination hostnames. flag = link goes live but is queued for review; reject = submission is refused."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add a term</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={adminAddBrandTermAction} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 space-y-1">
              <label htmlFor="term" className="text-xs text-zinc-500">
                Term (matched as a substring of the hostname)
              </label>
              <Input id="term" name="term" required placeholder="paypal" />
            </div>
            <div className="space-y-1">
              <label htmlFor="policy" className="text-xs text-zinc-500">
                Policy
              </label>
              <select
                id="policy"
                name="policy"
                defaultValue="flag"
                className="h-9 rounded-md border border-zinc-200 bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:border-zinc-800 dark:focus-visible:ring-zinc-300"
              >
                <option value="flag">flag (review)</option>
                <option value="reject">reject (block)</option>
              </select>
            </div>
            <Button type="submit">Add</Button>
          </form>
        </CardContent>
      </Card>

      <form method="get" className="mb-4 flex items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Search terms" className="max-w-xs" />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No brand terms" />
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Term</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>Added by</TableHead>
                <TableHead className="text-right">Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.term}>
                  <TableCell className="font-mono">{row.term}</TableCell>
                  <TableCell className="text-sm">
                    <span
                      className={
                        row.policy === 'reject'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }
                    >
                      {row.policy}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500">
                    {row.addedByEmail ?? 'seed'}
                  </TableCell>
                  <TableCell className="text-right text-xs text-zinc-500">
                    {formatDate(row.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <form action={adminRemoveBrandTermAction}>
                      <input type="hidden" name="term" value={row.term} />
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
