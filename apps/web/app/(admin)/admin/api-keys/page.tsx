import { and, db, desc, eq, ilike, isNull, recordAudit, schema, type SQL } from '@clipal/db';
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
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { RevokeKeyDialog } from '@/app/(app)/api-keys/create-key-dialog';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatDate, timeAgo } from '@/lib/format';
import { getClientIp, getUserAgent } from '@/lib/request';

export const metadata: Metadata = { title: 'Admin · API keys' };
export const dynamic = 'force-dynamic';

/**
 * Admin revoke. Unlike the user-facing action this is NOT scoped to the actor's
 * own keys — an admin may revoke any user's key — but it is still audited with
 * the admin as the actor. Defined inline so the admin keys page owns its own
 * mutation surface.
 */
async function adminRevokeApiKeyAction(formData: FormData): Promise<void> {
  'use server';
  const admin = await requireAdmin();
  const keyId = String(formData.get('keyId') ?? '');
  if (!keyId) return;

  const [updated] = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, keyId), isNull(schema.apiKeys.revokedAt)))
    .returning({ prefix: schema.apiKeys.prefix, userId: schema.apiKeys.userId });
  if (!updated) return;

  const h = await headers();
  await recordAudit(db, {
    actorId: admin.id,
    action: 'api_key.admin_revoke',
    targetType: 'api_key',
    targetId: keyId,
    metadata: { prefix: updated.prefix, ownerId: updated.userId },
    ip: getClientIp(h),
    userAgent: getUserAgent(h),
  });
  revalidatePath('/admin/api-keys');
}

export default async function AdminApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q = '' } = await searchParams;

  const conditions: SQL[] = [];
  if (q.trim()) conditions.push(ilike(schema.users.email, `%${q.trim()}%`));

  const rows = await db
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      prefix: schema.apiKeys.prefix,
      scopes: schema.apiKeys.scopes,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      createdAt: schema.apiKeys.createdAt,
      revokedAt: schema.apiKeys.revokedAt,
      expiresAt: schema.apiKeys.expiresAt,
      userId: schema.apiKeys.userId,
      email: schema.users.email,
    })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiKeys.userId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.apiKeys.createdAt))
    .limit(200);

  return (
    <div>
      <PageHeader
        title="API keys"
        description="Inspect and revoke any user's API keys. Secrets are never stored or shown."
      />

      <form method="get" className="mb-4 flex items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Filter by owner email" className="max-w-xs" />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No API keys found" />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
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
                    <TableCell className="max-w-[16rem] truncate text-sm">{k.email}</TableCell>
                    <TableCell className="max-w-[12rem] truncate font-medium">{k.name}</TableCell>
                    <TableCell>
                      <code className="font-mono text-sm text-muted-foreground">{k.prefix}…</code>
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
                        <RevokeKeyDialog
                          keyId={k.id}
                          name={k.name}
                          action={adminRevokeApiKeyAction}
                        />
                      )}
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
