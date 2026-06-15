import { customDomains, db, desc, eq, users } from '@clipal/db';
import {
  Badge,
  Button,
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
import { RefreshCw, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { adminRecheckDomainAction, adminRemoveDomainAction } from '../../actions';

export const metadata: Metadata = { title: 'Admin · Domains' };
export const dynamic = 'force-dynamic';

const STATUSES = ['all', 'pending_dns', 'pending_tls', 'active', 'error'] as const;
type StatusFilter = (typeof STATUSES)[number];
type DomainStatus = 'pending_dns' | 'pending_tls' | 'active' | 'error';

const STATUS_BADGE: Record<DomainStatus, 'active' | 'pending' | 'danger'> = {
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

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  pending_dns: 'Pending DNS',
  pending_tls: 'Issuing TLS',
  active: 'Active',
  error: 'Error',
};

function isStatus(v: string): v is StatusFilter {
  return (STATUSES as readonly string[]).includes(v);
}

export default async function AdminDomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status: statusParam = 'all' } = await searchParams;
  const status: StatusFilter = isStatus(statusParam) ? statusParam : 'all';

  const rows = await db
    .select({
      id: customDomains.id,
      domain: customDomains.domain,
      status: customDomains.status,
      errorMessage: customDomains.errorMessage,
      userId: customDomains.userId,
      email: users.email,
      lastCheckAt: customDomains.lastCheckAt,
      createdAt: customDomains.createdAt,
    })
    .from(customDomains)
    .innerJoin(users, eq(users.id, customDomains.userId))
    .where(status === 'all' ? undefined : eq(customDomains.status, status))
    .orderBy(desc(customDomains.createdAt));

  return (
    <div>
      <PageHeader
        title="Domains"
        description="Every custom domain on the platform — verification status and moderation."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={s === 'all' ? '/admin/domains' : `/admin/domains?status=${s}`}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              status === s
                ? 'border-foreground/30 bg-accent text-foreground'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {FILTER_LABEL[s]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No domains"
          description="No custom domains match this filter."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last check</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const st = row.status as DomainStatus;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-foreground break-all">
                      {row.domain}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/users/${row.userId}`}
                        className="text-foreground underline-offset-4 hover:underline"
                      >
                        {row.email}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={STATUS_BADGE[st]}>{STATUS_LABEL[st]}</Badge>
                        {st === 'error' && row.errorMessage ? (
                          <span className="text-xs text-destructive">
                            {row.errorMessage}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lastCheckAt ? formatDate(row.lastCheckAt) : 'Queued'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <form action={adminRecheckDomainAction}>
                          <input type="hidden" name="domainId" value={row.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            title="Re-check DNS now"
                          >
                            <RefreshCw className="size-4" />
                            <span className="sr-only">Re-check</span>
                          </Button>
                        </form>
                        <form action={adminRemoveDomainAction}>
                          <input type="hidden" name="domainId" value={row.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            title="Remove domain"
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">Remove</span>
                          </Button>
                        </form>
                      </div>
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
