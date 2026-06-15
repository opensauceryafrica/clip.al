import { planLimits, resolvePlan } from '@clipal/billing';
import { db, desc, eq, webhooks } from '@clipal/db';
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
import { formatDate } from '@/lib/format';
import { type WebhookEventType } from '@/lib/webhooks';
import { CreateWebhookDialog } from './webhook-form-dialog';

export const metadata: Metadata = { title: 'Webhooks' };
export const dynamic = 'force-dynamic';

export default async function WebhooksPage() {
  const user = await requireUser();

  const [rows, plan] = await Promise.all([
    db
      .select({
        id: webhooks.id,
        url: webhooks.url,
        events: webhooks.events,
        active: webhooks.active,
        failureCount: webhooks.failureCount,
        lastDeliveryAt: webhooks.lastDeliveryAt,
        createdAt: webhooks.createdAt,
      })
      .from(webhooks)
      .where(eq(webhooks.userId, user.id))
      .orderBy(desc(webhooks.createdAt)),
    resolvePlan(user.id),
  ]);

  const limit = planLimits(plan).webhooks;
  const canCreate = limit > 0 && rows.length < limit;

  return (
    <div>
      <PageHeader
        title="Webhooks"
        description="Receive signed event callbacks when your links change or are clicked."
        action={canCreate ? <CreateWebhookDialog /> : undefined}
      />

      {limit === 0 ? (
        <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Webhooks are available on the Pro and Business plans.{' '}
          <Link
            href="/settings/billing"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Upgrade
          </Link>{' '}
          to start receiving events.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No webhooks yet"
          description={
            limit === 0
              ? 'Upgrade to Pro to deliver events to your own endpoints.'
              : 'Add an endpoint to receive signed event callbacks.'
          }
          action={canCreate ? <CreateWebhookDialog triggerLabel="Add your first webhook" /> : undefined}
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Failures</TableHead>
                <TableHead className="text-right">Last delivery</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((w) => {
                const events = (w.events as WebhookEventType[]) ?? [];
                return (
                  <TableRow key={w.id}>
                    <TableCell className="max-w-[22rem] font-medium">
                      <Link
                        href={`/webhooks/${w.id}`}
                        className="block truncate font-mono text-sm hover:underline"
                      >
                        {w.url}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {events.length === 1 ? events[0] : `${events.length} events`}
                    </TableCell>
                    <TableCell>
                      {w.active ? (
                        <Badge variant="active">Active</Badge>
                      ) : (
                        <Badge variant="disabled">Disabled</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {w.failureCount > 0 ? (
                        <Badge variant="danger">{w.failureCount}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {w.lastDeliveryAt ? formatDate(w.lastDeliveryAt) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {limit > 0 && rows.length >= limit ? (
        <p className="mt-3 text-sm text-muted-foreground">
          You&apos;ve used all {limit} webhook endpoint{limit === 1 ? '' : 's'} on your plan.
        </p>
      ) : null}

      <p className="mt-6 max-w-prose text-sm text-muted-foreground">
        Each delivery is signed with an <code className="font-mono">X-clipal-Signature</code>{' '}
        header (<code className="font-mono">t=&lt;unix&gt;, v1=&lt;hmac_sha256&gt;</code> over{' '}
        <code className="font-mono">&lt;timestamp&gt;.&lt;raw_body&gt;</code>). Verify it with
        your endpoint&apos;s signing secret before trusting a payload.
      </p>
    </div>
  );
}
