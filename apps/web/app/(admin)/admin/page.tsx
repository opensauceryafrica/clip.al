import { clicksToday } from '@clipal/ch';
import { blockedDomains, count, db, eq, gt, gte, links, sql, users } from '@clipal/db';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { requireAdmin } from '@/lib/auth';
import { formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function scalarCount(promise: Promise<Array<{ c: number }>>): Promise<number> {
  const rows = await promise;
  return rows[0]?.c ?? 0;
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const today = startOfTodayUtc();

  const [linksToday, signupsToday, pendingReports, suspended, blocked, todaysClicks] =
    await Promise.all([
      scalarCount(db.select({ c: count() }).from(links).where(gte(links.createdAt, today))),
      scalarCount(db.select({ c: count() }).from(users).where(gte(users.createdAt, today))),
      scalarCount(db.select({ c: count() }).from(links).where(gt(links.reportCount, 0))),
      scalarCount(db.select({ c: count() }).from(users).where(eq(users.status, 'suspended'))),
      scalarCount(db.select({ c: count() }).from(blockedDomains).where(sql`true`)),
      clicksToday().catch(() => 0),
    ]);

  return (
    <div>
      <PageHeader title="Overview" description="Platform health at a glance." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Links today" value={formatNumber(linksToday)} />
        <StatCard label="Clicks today" value={formatNumber(todaysClicks)} />
        <StatCard label="Signups today" value={formatNumber(signupsToday)} />
        <StatCard label="Links with reports" value={formatNumber(pendingReports)} />
        <StatCard label="Suspended users" value={formatNumber(suspended)} />
        <StatCard label="Blocked domains" value={formatNumber(blocked)} />
      </div>
    </div>
  );
}
