import {
  and,
  db,
  desc,
  eq,
  webhookDeliveries,
  webhooks,
} from '@clipal/db';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  KeyValue,
  KeyValueRow,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@clipal/ui';
import { Pencil, Send } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { requireUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { type WebhookEventType } from '@/lib/webhooks';
import {
  deleteWebhookAction,
  replayDeliveryAction,
  testWebhookAction,
  toggleWebhookAction,
} from '../actions';
import { EditWebhookDialog } from '../webhook-form-dialog';
import { CopyPayloadButton } from './delivery-actions';

export const metadata: Metadata = { title: 'Webhook' };
export const dynamic = 'force-dynamic';

const RECENT_LIMIT = 50;

/** Status pill for a delivery row based on its delivered/attempt state. */
function deliveryBadge(d: {
  deliveredAt: Date | null;
  responseStatus: number | null;
  attempts: number;
}) {
  if (d.deliveredAt) return <Badge variant="active">Delivered</Badge>;
  if (d.attempts === 0) return <Badge variant="pending">Pending</Badge>;
  return <Badge variant="danger">Failed</Badge>;
}

export default async function WebhookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  // Own-the-webhook guard.
  const [webhook] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.userId, user.id)))
    .limit(1);

  if (!webhook) notFound();

  const deliveries = await db
    .select({
      id: webhookDeliveries.id,
      eventType: webhookDeliveries.eventType,
      payload: webhookDeliveries.payload,
      responseStatus: webhookDeliveries.responseStatus,
      responseBody: webhookDeliveries.responseBody,
      attempts: webhookDeliveries.attempts,
      deliveredAt: webhookDeliveries.deliveredAt,
      nextRetryAt: webhookDeliveries.nextRetryAt,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(RECENT_LIMIT);

  const events = (webhook.events as WebhookEventType[]) ?? [];

  return (
    <div>
      <PageHeader
        title="Webhook"
        description="Delivery history and endpoint settings."
        action={
          <div className="flex items-center gap-2">
            <form action={testWebhookAction}>
              <input type="hidden" name="webhookId" value={webhook.id} />
              <Button type="submit" variant="secondary" size="sm">
                <Send className="size-4" />
                Send test
              </Button>
            </form>
            <EditWebhookDialog
              webhookId={webhook.id}
              url={webhook.url}
              events={events}
              trigger={
                <Button variant="secondary" size="sm">
                  <Pencil className="size-4" />
                  Edit
                </Button>
              }
            />
          </div>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Endpoint</CardTitle>
          </CardHeader>
          <CardContent>
            <KeyValue>
              <KeyValueRow label="URL">
                <span className="font-mono">{webhook.url}</span>
              </KeyValueRow>
              <KeyValueRow label="Status">
                {webhook.active ? (
                  <Badge variant="active">Active</Badge>
                ) : (
                  <Badge variant="disabled">Disabled</Badge>
                )}
              </KeyValueRow>
              <KeyValueRow label="Events">{events.join(', ')}</KeyValueRow>
              <KeyValueRow label="Failures">{webhook.failureCount}</KeyValueRow>
              <KeyValueRow label="Last success">
                {webhook.lastSuccessAt ? formatDateTime(webhook.lastSuccessAt) : '—'}
              </KeyValueRow>
              <KeyValueRow label="Last failure">
                {webhook.lastFailureAt ? formatDateTime(webhook.lastFailureAt) : '—'}
              </KeyValueRow>
            </KeyValue>

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
              <form action={toggleWebhookAction}>
                <input type="hidden" name="webhookId" value={webhook.id} />
                <input type="hidden" name="active" value={webhook.active ? 'false' : 'true'} />
                <Button type="submit" variant="secondary" size="sm">
                  {webhook.active ? 'Disable' : 'Enable'}
                </Button>
              </form>
              <form action={deleteWebhookAction}>
                <input type="hidden" name="webhookId" value={webhook.id} />
                <Button type="submit" variant="destructive" size="sm">
                  Delete
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Signing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Every request carries an <code className="font-mono">X-clipal-Signature</code>{' '}
              header:
            </p>
            <pre className="overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground">
              t=&lt;unix_seconds&gt;, v1=&lt;hmac_sha256_hex&gt;
            </pre>
            <p>
              The HMAC is computed over{' '}
              <code className="font-mono">&lt;timestamp&gt;.&lt;raw_body&gt;</code> using your
              endpoint&apos;s signing secret. Reject requests whose timestamp is too old to guard
              against replay.
            </p>
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold tracking-tight text-foreground">
        Recent deliveries
      </h2>

      {deliveries.length === 0 ? (
        <EmptyState
          title="No deliveries yet"
          description="Send a test or trigger an event to see deliveries here."
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead>Response</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                  <TableCell>{deliveryBadge(d)}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {d.attempts}
                  </TableCell>
                  <TableCell className="max-w-[14rem] text-sm text-muted-foreground">
                    {d.responseStatus !== null ? (
                      <span className="truncate font-mono">
                        {d.responseStatus}
                        {d.responseBody ? ` — ${d.responseBody.slice(0, 60)}` : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(d.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <CopyPayloadButton payload={d.payload} />
                      <form action={replayDeliveryAction}>
                        <input type="hidden" name="deliveryId" value={d.id} />
                        <Button type="submit" variant="secondary" size="sm">
                          Replay
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

      <p className="mt-4 text-sm text-muted-foreground">
        <Link href="/webhooks" className="underline-offset-4 hover:underline">
          ← Back to webhooks
        </Link>
      </p>
    </div>
  );
}
