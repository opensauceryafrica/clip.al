import { planLimits, resolvePlan } from '@clipal/billing';
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
import { listApiKeysForUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { formatDate, timeAgo } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { revokeApiKeyAction } from './actions';
import { CreateKeyDialog, RevokeKeyDialog, RotateKeyDialog } from './create-key-dialog';

export const metadata: Metadata = { title: 'API keys' };
export const dynamic = 'force-dynamic';

/** `clpl_live_a1b2…` — show only the indexed prefix, never the secret. */
function maskedPrefix(prefix: string): string {
  return `${prefix}…`;
}

export default async function ApiKeysPage() {
  const user = await requireUser();

  const [rows, plan] = await Promise.all([listApiKeysForUser(user.id), resolvePlan(user.id)]);
  const apiEnabled = planLimits(plan).apiRequestsPerMonth > 0;
  const active = rows.filter((k) => !k.revokedAt);

  return (
    <div>
      <PageHeader
        title="API keys"
        description="Authenticate programmatic access to the clip.al API."
        action={apiEnabled ? <CreateKeyDialog /> : undefined}
      />

      {!apiEnabled ? (
        <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          API access is available on the Pro and Business plans.{' '}
          <Link
            href="/settings/billing"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Upgrade
          </Link>{' '}
          to start issuing keys.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No API keys yet"
          description={
            apiEnabled
              ? 'Create a key to authenticate requests to the clip.al API.'
              : 'Upgrade to Pro to issue API keys.'
          }
          action={apiEnabled ? <CreateKeyDialog /> : undefined}
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead className="text-right">Last used</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((k) => {
                const revoked = !!k.revokedAt;
                const expired = !!k.expiresAt && k.expiresAt.getTime() <= Date.now();
                return (
                  <TableRow key={k.id} className={revoked ? 'opacity-60' : undefined}>
                    <TableCell className="max-w-[14rem] truncate font-medium">{k.name}</TableCell>
                    <TableCell>
                      <code className="font-mono text-sm text-muted-foreground">
                        {maskedPrefix(k.prefix)}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.length === 0 ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          k.scopes.map((s) => (
                            <Badge key={s} variant="neutral" className="font-mono text-[11px]">
                              {s}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Never'}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatDate(k.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {revoked ? (
                        <Badge variant="disabled">Revoked</Badge>
                      ) : expired ? (
                        <Badge variant="danger">Expired</Badge>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <RotateKeyDialog keyId={k.id} name={k.name} />
                          <RevokeKeyDialog keyId={k.id} name={k.name} action={revokeApiKeyAction} />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {apiEnabled ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {active.length} active key{active.length === 1 ? '' : 's'} · {planLimits(plan).apiRequestsPerMonth.toLocaleString()} requests/month on the {plan} plan.
        </p>
      ) : null}

      <p className="mt-6 max-w-prose text-sm text-muted-foreground">
        Send your key in the{' '}
        <code className="font-mono">Authorization: Bearer clpl_live_…</code> header. Each key carries
        scopes — <code className="font-mono">links:read</code>,{' '}
        <code className="font-mono">links:write</code>, and{' '}
        <code className="font-mono">analytics:read</code> — that gate which endpoints it may call. The
        full secret is shown only once at creation; if you lose it, rotate the key.
      </p>
    </div>
  );
}
