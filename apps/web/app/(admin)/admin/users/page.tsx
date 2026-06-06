import { and, db, desc, ilike, links, sql, users, type SQL } from '@clipal/db';
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
import {
  adminChangeRoleAction,
  adminSuspendUserAction,
  adminUnsuspendUserAction,
} from '@/app/(admin)/actions';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin · Users' };
export const dynamic = 'force-dynamic';

const ROLES = ['user', 'moderator', 'admin'] as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const admin = await requireAdmin();
  const canChangeRoles = admin.role === 'admin';
  const { q = '' } = await searchParams;

  const conditions: SQL[] = [];
  if (q.trim()) conditions.push(ilike(users.email, `%${q.trim()}%`));

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      linksCount: sql<number>`(select count(*) from ${links} where ${links.ownerId} = ${users.id})`,
    })
    .from(users)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(100);

  return (
    <div>
      <PageHeader title="Users" description="Search, suspend, and manage roles." />

      <form method="get" className="mb-4 flex items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Search by email" className="max-w-xs" />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Links</TableHead>
                <TableHead className="text-right">Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="max-w-[16rem] truncate">{u.email}</TableCell>
                  <TableCell>
                    {canChangeRoles ? (
                      <form action={adminChangeRoleAction} className="flex items-center gap-1">
                        <input type="hidden" name="userId" value={u.id} />
                        <select
                          name="role"
                          defaultValue={u.role}
                          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" variant="ghost" size="sm">
                          Set
                        </Button>
                      </form>
                    ) : (
                      <Badge variant="neutral">{u.role}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === 'active' ? 'active' : u.status === 'suspended' ? 'danger' : 'disabled'}>
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{u.linksCount}</TableCell>
                  <TableCell className="text-right text-xs text-zinc-500">{formatDate(u.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {u.id === admin.id ? (
                      <span className="text-xs text-zinc-400">you</span>
                    ) : u.status === 'suspended' ? (
                      <form action={adminUnsuspendUserAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Unsuspend
                        </Button>
                      </form>
                    ) : (
                      <form action={adminSuspendUserAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <Button type="submit" variant="ghost" size="sm" className="text-red-600">
                          Suspend
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
