import { planLimits, resolvePlan } from '@clipal/billing';
import { env } from '@clipal/config';
import { customDomains, db, desc, eq } from '@clipal/db';
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
import { DomainAddForm } from './domain-add-form';
import { DomainRowActions } from './domain-row-actions';

export const metadata: Metadata = { title: 'Domains' };
export const dynamic = 'force-dynamic';

type DomainStatus = 'pending_dns' | 'pending_tls' | 'active' | 'error';

const STATUS_BADGE: Record<DomainStatus, 'active' | 'pending' | 'danger' | 'neutral'> = {
  active: 'active',
  pending_dns: 'pending',
  pending_tls: 'pending',
  error: 'danger',
};

const STATUS_LABEL: Record<DomainStatus, string> = {
  pending_dns: 'Pending DNS',
  pending_tls: 'Issuing TLS',
  active: 'Active',
  error: 'Error',
};

export default async function DomainsPage() {
  const user = await requireUser();

  const [rows, plan] = await Promise.all([
    db
      .select({
        id: customDomains.id,
        domain: customDomains.domain,
        status: customDomains.status,
        verificationToken: customDomains.verificationToken,
        errorMessage: customDomains.errorMessage,
        createdAt: customDomains.createdAt,
      })
      .from(customDomains)
      .where(eq(customDomains.userId, user.id))
      .orderBy(desc(customDomains.createdAt)),
    resolvePlan(user.id),
  ]);

  const cap = planLimits(plan).customDomains;
  const canAdd = cap > 0 && rows.length < cap;
  const cnameTarget = env.DOMAINS_CNAME_TARGET;

  return (
    <div>
      <PageHeader
        title="Domains"
        description="Serve your short links from your own branded domain."
      />

      {cap === 0 ? (
        <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Custom domains are available on the Pro and Business plans.{' '}
          <Link
            href="/settings/billing"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Upgrade your plan
          </Link>
          .
        </div>
      ) : canAdd ? (
        <DomainAddForm />
      ) : (
        <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          You&apos;ve reached your plan&apos;s limit of {cap} custom domain
          {cap === 1 ? '' : 's'}. Remove one to add another
          {plan !== 'business' ? (
            <>
              , or{' '}
              <Link
                href="/settings/billing"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                upgrade
              </Link>
            </>
          ) : null}
          .
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No custom domains yet"
          description={
            cap === 0
              ? 'Upgrade to Pro or Business to connect your own domain.'
              : 'Add a subdomain you control to start serving branded short links.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const status = row.status as DomainStatus;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-foreground break-all">
                      {row.domain}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={STATUS_BADGE[status]}>
                          {STATUS_LABEL[status]}
                        </Badge>
                        {status === 'error' && row.errorMessage ? (
                          <span className="text-xs text-destructive">
                            {row.errorMessage}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DomainRowActions
                        domainId={row.id}
                        domain={row.domain}
                        cnameTarget={cnameTarget}
                        verificationToken={row.verificationToken}
                        status={status}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
