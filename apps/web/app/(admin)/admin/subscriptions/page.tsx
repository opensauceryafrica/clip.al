import {
  and,
  db,
  desc,
  eq,
  ilike,
  subscriptions,
  users,
  type SQL,
} from '@clipal/db';
import {
  Badge,
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
import { adminCancelSubscriptionAction } from '@/app/(admin)/actions';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin · Subscriptions' };
export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, 'active' | 'pending' | 'danger' | 'disabled'> = {
  active: 'active',
  past_due: 'danger',
  cancelled: 'pending',
  expired: 'disabled',
};

const PLAN_BADGE: Record<string, string> = { free: 'F', pro: 'P', business: 'B' };

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q = '' } = await searchParams;

  const conditions: SQL[] = [];
  if (q.trim()) conditions.push(ilike(users.email, `%${q.trim()}%`));

  const rows = await db
    .select({
      userId: subscriptions.userId,
      email: users.email,
      plan: subscriptions.plan,
      interval: subscriptions.interval,
      status: subscriptions.status,
      processor: subscriptions.processor,
      currency: subscriptions.currency,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(subscriptions.updatedAt))
    .limit(100);

  return (
    <div>
      <PageHeader
        title="Subscriptions"
        description="Paying users, their plan, processor, and period."
      />

      <form method="get" className="mb-4 flex items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Search by email" className="max-w-xs" />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No subscriptions found" />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Processor</TableHead>
                <TableHead className="text-right">Period end</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.userId}>
                  <TableCell className="max-w-[16rem] truncate">
                    <Link href={`/admin/users/${s.userId}`} className="hover:underline">
                      {s.email}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex size-5 items-center justify-center rounded border border-border bg-muted text-[10px] font-semibold text-foreground">
                        {PLAN_BADGE[s.plan] ?? '?'}
                      </span>
                      <span className="text-xs capitalize text-muted-foreground">
                        {s.plan}
                        {s.interval ? ` · ${s.interval}` : ''}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <Badge variant={STATUS_BADGE[s.status] ?? 'neutral'}>{s.status}</Badge>
                      {s.cancelAtPeriodEnd ? (
                        <span className="text-[10px] text-muted-foreground">cancels</span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.processor === 'paystack'
                      ? 'Paystack'
                      : s.processor === 'polar'
                        ? 'Polar'
                        : '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {s.plan === 'free' ? (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    ) : (
                      <form action={adminCancelSubscriptionAction}>
                        <input type="hidden" name="userId" value={s.userId} />
                        <Button type="submit" variant="ghost" size="sm" className="text-red-600">
                          Cancel
                        </Button>
                      </form>
                    )}
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
