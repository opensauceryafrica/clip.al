import { verifySession } from '@clipal/auth';
import { SESSION_COOKIE_NAME } from '@clipal/config/constants';
import { and, db, desc, eq, isNull, sessions } from '@clipal/db';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@clipal/ui';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { DeleteAccountDialog } from '@/components/delete-account-dialog';
import { PageHeader } from '@/components/page-header';
import { ProfileForm } from '@/components/profile-form';
import { requireUser } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { revokeSessionAction } from './actions';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

function describeDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  return ua.length > 64 ? `${ua.slice(0, 64)}…` : ua;
}

export default async function SettingsPage() {
  const user = await requireUser();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const claims = token ? await verifySession(token) : null;
  const currentSid = claims?.sid;

  const userSessions = await db
    .select({
      id: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(50);

  return (
    <div>
      <PageHeader title="Settings" description="Manage your profile, sessions, and account." />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm displayName={user.displayName ?? ''} email={user.email} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {userSessions.map((s) => {
                const isCurrent = s.id === currentSid;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                        {describeDevice(s.userAgent)}
                        {isCurrent ? (
                          <span className="ml-2 text-xs text-emerald-600">this device</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {s.ip ?? 'unknown IP'} · active {timeAgo(s.lastSeenAt)}
                      </p>
                    </div>
                    {isCurrent ? (
                      <span className="shrink-0 text-xs text-zinc-400">current</span>
                    ) : (
                      <form action={revokeSessionAction}>
                        <input type="hidden" name="sessionId" value={s.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Revoke
                        </Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-sm text-zinc-500">
              Delete your account and stop all your links from redirecting.
            </p>
            <DeleteAccountDialog />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
