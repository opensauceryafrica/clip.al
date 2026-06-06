import { and, authCodes, db, isNotNull, lt, or, sessions, sql } from '@clipal/db';

/** §18.5 — delete consumed/expired auth codes older than 24h. */
export async function reapAuthCodes(): Promise<void> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db
    .delete(authCodes)
    .where(
      and(
        lt(authCodes.createdAt, dayAgo),
        or(isNotNull(authCodes.consumedAt), lt(authCodes.expiresAt, sql`now()`)),
      ),
    );
}

/** §18.6 — delete revoked or long-idle (>60d) sessions. */
export async function reapSessions(): Promise<void> {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  await db
    .delete(sessions)
    .where(or(isNotNull(sessions.revokedAt), lt(sessions.lastSeenAt, sixtyDaysAgo)));
}
