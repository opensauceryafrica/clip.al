'use server';

import { invalidateUserCache, revokeAllSessions, revokeSession } from '@clipal/auth';
import { and, db, eq, sessions, users } from '@clipal/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormActionState } from '@/lib/action-state';
import { clearSessionCookie, requireUser } from '@/lib/auth';

export async function updateProfileAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const displayName = String(formData.get('displayName') ?? '').trim().slice(0, 80);

  await db
    .update(users)
    .set({ displayName: displayName || null })
    .where(eq(users.id, user.id));
  await invalidateUserCache(user.id);
  revalidatePath('/settings');
  return { ok: true };
}

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sessionId = String(formData.get('sessionId') ?? '');

  // Only allow revoking your own sessions.
  const [owned] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, user.id)))
    .limit(1);
  if (owned) await revokeSession(sessionId);
  revalidatePath('/settings');
}

/**
 * Soft-delete: mark the account deleted and log out everywhere. The account is
 * retained, then hard-deleted (with its links/sessions/auth codes) by the
 * worker's daily `account-purge` job after ACCOUNT_PURGE_GRACE_DAYS (default 30)
 * — see apps/worker/src/loops/purge.ts.
 */
export async function deleteAccountAction(): Promise<void> {
  const user = await requireUser();
  await db.update(users).set({ status: 'deleted' }).where(eq(users.id, user.id));
  await revokeAllSessions(user.id);
  await invalidateUserCache(user.id);
  await clearSessionCookie();
  redirect('/');
}
