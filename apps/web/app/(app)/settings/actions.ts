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
 * retained for 30 days then purged.
 * TODO(@owner): a 30-day hard-purge job isn't in the Phase 1 worker (§18) — add a
 * daily reaper that deletes users with status='deleted' older than 30 days.
 */
export async function deleteAccountAction(): Promise<void> {
  const user = await requireUser();
  await db.update(users).set({ status: 'deleted' }).where(eq(users.id, user.id));
  await revokeAllSessions(user.id);
  await invalidateUserCache(user.id);
  await clearSessionCookie();
  redirect('/');
}
