import { env } from '@clipal/config';
import { and, authCodes, db, eq, inArray, links, lt, sessions, users } from '@clipal/db';

/**
 * §18.x — daily account purge. Hard-deletes users that have been soft-deleted
 * (status='deleted') for longer than ACCOUNT_PURGE_GRACE_DAYS (default 30),
 * cascading to the data they own.
 *
 * FK behaviour means a naive `DELETE FROM users` would NOT do the right thing,
 * so each ref is handled deliberately:
 *  - links.owner_id is ON DELETE SET NULL — deleting the user would orphan their
 *    links as anonymous rows. A purge wants them gone, so we delete the links
 *    explicitly first (link_reports about those links cascade-delete with them).
 *  - auth_codes has NO FK to users (it is keyed by email), so it must be deleted
 *    by email explicitly.
 *  - sessions.user_id is ON DELETE CASCADE — they would vanish with the user, but
 *    we delete them explicitly so the log line can report an accurate count.
 *  - audit_log.actor_id is ON DELETE SET NULL — deleting the user anonymizes the
 *    actor on entries THEY created while preserving the rows. We deliberately do
 *    NOT delete from audit_log: entries about other actors, and the historical
 *    record of what happened, must survive. link_reports.reporter_user_id is the
 *    same (set null) for reports the purged user filed on other people's links.
 *
 * Everything runs in one transaction, so a mid-purge failure leaves the account
 * fully intact for the next daily run.
 */
export async function purgeDeletedAccounts(): Promise<void> {
  const graceDays = env.ACCOUNT_PURGE_GRACE_DAYS;
  const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);

  const summary = await db.transaction(async (tx) => {
    const targets = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.status, 'deleted'), lt(users.updatedAt, cutoff)));

    if (targets.length === 0) return { users: 0, links: 0, sessions: 0 };

    const ids = targets.map((t) => t.id);
    const emails = targets.map((t) => t.email);

    const deletedLinks = await tx
      .delete(links)
      .where(inArray(links.ownerId, ids))
      .returning({ id: links.id });

    const deletedSessions = await tx
      .delete(sessions)
      .where(inArray(sessions.userId, ids))
      .returning({ id: sessions.id });

    // No FK from auth_codes → users; key on the (unique, case-insensitive) email.
    await tx.delete(authCodes).where(inArray(authCodes.email, emails));

    // Deleting the user set-nulls audit_log.actor_id and link_reports.reporter_user_id
    // (and any remaining links.owner_id — none left here) without removing rows.
    const deletedUsers = await tx
      .delete(users)
      .where(inArray(users.id, ids))
      .returning({ id: users.id });

    return {
      users: deletedUsers.length,
      links: deletedLinks.length,
      sessions: deletedSessions.length,
    };
  });

  if (summary.users > 0) {
    console.log(
      `[purge] hard-deleted ${summary.users} users (${summary.links} links, ${summary.sessions} sessions)`,
    );
  }
}
