import { can, resolvePlan } from '@clipal/billing';
import { campaigns, db, desc, eq, links, sql } from '@clipal/db';
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
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { requireUser } from '@/lib/auth';
import { formatDate, formatNumber } from '@/lib/format';
import { CreateCampaignDialog } from './create-campaign-dialog';

export const metadata: Metadata = { title: 'Campaigns' };
export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const user = await requireUser();

  // List the user's campaigns with a denormalized link count. LEFT JOIN keeps
  // empty campaigns visible; we count non-null link ids so the join's null row
  // for an empty campaign reads as 0.
  const [rows, plan] = await Promise.all([
    db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        createdAt: campaigns.createdAt,
        linkCount: sql<number>`count(${links.id})::int`,
      })
      .from(campaigns)
      .leftJoin(links, eq(links.campaignId, campaigns.id))
      .where(eq(campaigns.userId, user.id))
      .groupBy(campaigns.id)
      .orderBy(desc(campaigns.createdAt)),
    resolvePlan(user.id),
  ]);

  const canCreate = can(plan, 'abTesting');

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Group links into A/B tests and tracked campaigns."
        action={canCreate ? <CreateCampaignDialog /> : undefined}
      />

      {!canCreate ? (
        <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Campaigns and A/B testing are available on the Pro and Business plans.{' '}
          <Link href="/settings/billing" className="font-medium text-foreground underline-offset-4 hover:underline">
            Upgrade
          </Link>{' '}
          to start grouping links.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description={
            canCreate
              ? 'Create a campaign to group links and run A/B tests.'
              : 'Upgrade to Pro to create campaigns and run A/B tests.'
          }
          action={canCreate ? <CreateCampaignDialog triggerLabel="Create your first campaign" /> : undefined}
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Links</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link href={`/campaigns/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge>{formatNumber(c.linkCount)}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {formatDate(c.createdAt)}
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
