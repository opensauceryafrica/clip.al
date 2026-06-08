import { auditLog, db, desc, eq, links, or, sessions, sql, users } from '@clipal/db';
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
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  adminChangeRoleAction,
  adminSuspendUserAction,
  adminUnsuspendUserAction,
} from '@/app/(admin)/actions';
import { LinkStatusBadge } from '@/components/link-status-badge';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatDate, formatDateTime, formatNumber, timeAgo } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin · User' };
export const dynamic = 'force-dynamic';

const ROLES = ['user', 'moderator', 'admin'] as const;

function statusVariant(status: string): 'active' | 'danger' | 'disabled' {
  return status === 'active' ? 'active' : status === 'suspended' ? 'danger' : 'disabled';
}

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const canChangeRoles = admin.role === 'admin';
  const { id } = await params;

  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) notFound();

  const [stats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      clicks: sql<string>`coalesce(sum(${links.clicksTotal}), 0)`,
    })
    .from(links)
    .where(eq(links.ownerId, id));

  const [sess] = await db
    .select({
      active: sql<number>`count(*) filter (where ${sessions.revokedAt} is null)::int`,
      lastSeen: sql<string | null>`max(${sessions.lastSeenAt})`,
    })
    .from(sessions)
    .where(eq(sessions.userId, id));

  const recentLinks = await db
    .select({
      id: links.id,
      code: links.code,
      status: links.status,
      clicksTotal: links.clicksTotal,
      createdAt: links.createdAt,
    })
    .from(links)
    .where(eq(links.ownerId, id))
    .orderBy(desc(links.createdAt))
    .limit(10);

  const activity = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      actorId: auditLog.actorId,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(or(eq(auditLog.actorId, id), eq(auditLog.targetId, id)))
    .orderBy(desc(auditLog.createdAt))
    .limit(20);

  const isSelf = user.id === admin.id;
  const lastSeen = sess?.lastSeen ? formatDateTime(new Date(sess.lastSeen)) : 'Never';

  return (
    <div>
      <PageHeader title={user.email} description="User details and activity" />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <KeyValue>
              <KeyValueRow label="Email">{user.email}</KeyValueRow>
              <KeyValueRow label="Display name">{user.displayName ?? '—'}</KeyValueRow>
              <KeyValueRow label="Role">
                <Badge variant="neutral">{user.role}</Badge>
              </KeyValueRow>
              <KeyValueRow label="Status">
                <Badge variant={statusVariant(user.status)}>{user.status}</Badge>
              </KeyValueRow>
              <KeyValueRow label="Links">{formatNumber(stats?.count ?? 0)}</KeyValueRow>
              <KeyValueRow label="Total clicks">{formatNumber(Number(stats?.clicks ?? 0))}</KeyValueRow>
              <KeyValueRow label="Active sessions">{formatNumber(sess?.active ?? 0)}</KeyValueRow>
              <KeyValueRow label="Last seen">{lastSeen}</KeyValueRow>
              <KeyValueRow label="Migrated from abbrefy">
                {user.migratedFromAbbrefy ? 'Yes' : 'No'}
              </KeyValueRow>
              <KeyValueRow label="Joined">{formatDate(user.createdAt)}</KeyValueRow>
              <KeyValueRow label="User ID">
                <span className="font-mono text-xs text-muted-foreground">{user.id}</span>
              </KeyValueRow>
            </KeyValue>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Management</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSelf ? (
              <p className="text-sm text-muted-foreground">This is your own account.</p>
            ) : (
              <>
                {canChangeRoles ? (
                  <form action={adminChangeRoleAction} className="space-y-1">
                    <label htmlFor="role" className="text-xs text-muted-foreground">
                      Role
                    </label>
                    <div className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={user.id} />
                      <select
                        id="role"
                        name="role"
                        defaultValue={user.role}
                        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="secondary" size="sm">
                        Set role
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Changing a role signs the user out everywhere.
                    </p>
                  </form>
                ) : (
                  <p className="text-sm text-muted-foreground">Only admins can change roles.</p>
                )}

                <div className="border-t border-border pt-4">
                  {user.status === 'suspended' ? (
                    <form action={adminUnsuspendUserAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <Button type="submit" variant="secondary" size="sm">
                        Unsuspend account
                      </Button>
                    </form>
                  ) : (
                    <form action={adminSuspendUserAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <Button type="submit" variant="destructive" size="sm">
                        Suspend account
                      </Button>
                    </form>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-foreground">Recent links</h2>
        {recentLinks.length === 0 ? (
          <EmptyState title="No links" />
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentLinks.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Link href={`/admin/links/${l.id}`} className="font-mono hover:underline">
                        {l.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <LinkStatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(l.clicksTotal)}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {timeAgo(l.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-foreground">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit activity for this user.</p>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.action}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.targetType}:{a.targetId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.actorId === id ? 'actor' : 'target'}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {timeAgo(a.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
