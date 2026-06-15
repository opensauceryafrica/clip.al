import { db, desc, eq, invoices, users } from '@clipal/db';
import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@clipal/ui';
import type { Currency } from '@clipal/config';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin · Invoices' };
export const dynamic = 'force-dynamic';

const STATUSES = ['all', 'paid', 'pending', 'failed', 'refunded'] as const;
type StatusFilter = (typeof STATUSES)[number];

const INVOICE_BADGE: Record<string, 'active' | 'pending' | 'danger' | 'disabled'> = {
  paid: 'active',
  pending: 'pending',
  failed: 'danger',
  refunded: 'disabled',
};

function formatMinor(amountMinor: number, currency: Currency): string {
  if (currency === 'NGN') {
    return `₦${Math.round(amountMinor / 100).toLocaleString('en-NG')}`;
  }
  return `$${(amountMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function isStatus(v: string): v is StatusFilter {
  return (STATUSES as readonly string[]).includes(v);
}

export default async function AdminInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status: statusParam = 'all' } = await searchParams;
  const status: StatusFilter = isStatus(statusParam) ? statusParam : 'all';

  const rows = await db
    .select({
      id: invoices.id,
      userId: invoices.userId,
      email: users.email,
      processor: invoices.processor,
      providerReference: invoices.providerReference,
      amountMinor: invoices.amountMinor,
      currency: invoices.currency,
      status: invoices.status,
      paidAt: invoices.paidAt,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .innerJoin(users, eq(users.id, invoices.userId))
    .where(status === 'all' ? undefined : eq(invoices.status, status))
    .orderBy(desc(invoices.createdAt))
    .limit(200);

  return (
    <div>
      <PageHeader title="Invoices" description="Every billing invoice across processors." />

      {/* Status filter — links keep the page server-rendered (no client JS). */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {STATUSES.map((s) => {
          const active = s === status;
          return (
            <Link
              key={s}
              href={s === 'all' ? '/admin/invoices' : `/admin/invoices?status=${s}`}
              className={
                active
                  ? 'rounded-md border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm'
                  : 'rounded-md border border-transparent px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground'
              }
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No invoices" description="No invoices match this filter." />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Processor</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(inv.paidAt ?? inv.createdAt)}
                  </TableCell>
                  <TableCell className="max-w-[14rem] truncate">
                    <Link href={`/admin/users/${inv.userId}`} className="hover:underline">
                      {inv.email}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatMinor(inv.amountMinor, inv.currency as Currency)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {inv.processor === 'paystack' ? 'Paystack' : 'Polar'}
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate font-mono text-xs text-muted-foreground">
                    {inv.providerReference}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={INVOICE_BADGE[inv.status] ?? 'neutral'}>{inv.status}</Badge>
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
