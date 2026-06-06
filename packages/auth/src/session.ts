import { keys, redis } from '@clipal/cache';
import {
  SESSION_LAST_SEEN_THROTTLE_SECONDS,
  SESSION_TTL_SECONDS,
  USER_CACHE_TTL_SECONDS,
} from '@clipal/config/constants';
import { and, db, eq, isNull, sessions, users } from '@clipal/db';
import { signSession, verifySession } from './jwt';

export type UserRole = 'user' | 'moderator' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'deleted';

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  displayName: string | null;
}

/** Create a session row and mint its JWT. */
export async function createSession(
  userId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<{ token: string; sid: string }> {
  const [row] = await db
    .insert(sessions)
    .values({ userId, ip, userAgent })
    .returning({ id: sessions.id });
  if (!row) throw new Error('failed to create session');
  const token = await signSession({ sub: userId, sid: row.id });
  return { token, sid: row.id };
}

/** Revoke one session: DB flag + Redis denylist fast-path (§8). */
export async function revokeSession(sid: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sid));
  await redis.set(keys.sessionRevoked(sid), '1', 'EX', SESSION_TTL_SECONDS);
}

/** Revoke every active session for a user (used on suspension / "log out everywhere"). */
export async function revokeAllSessions(userId: string): Promise<void> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (rows.length === 0) return;
  const pipeline = redis.pipeline();
  for (const r of rows) pipeline.set(keys.sessionRevoked(r.id), '1', 'EX', SESSION_TTL_SECONDS);
  await pipeline.exec();
}

export async function invalidateUserCache(userId: string): Promise<void> {
  await redis.del(keys.userCache(userId));
}

/**
 * Validate a session token end-to-end (§8): verify JWT → check Redis revocation
 * denylist → hydrate the user (60s Redis cache, Postgres on miss) → reject
 * non-active users → throttle the last_seen_at write to ≤ hourly.
 */
export async function validateSession(token: string): Promise<SessionUser | null> {
  const claims = await verifySession(token);
  if (!claims) return null;

  if (await redis.exists(keys.sessionRevoked(claims.sid))) return null;

  const user = await loadUser(claims.sub);
  if (!user || user.status !== 'active') return null;

  void touchLastSeen(claims.sid);
  return user;
}

async function loadUser(userId: string): Promise<SessionUser | null> {
  const cacheKey = keys.userCache(userId);
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as SessionUser;
    } catch {
      // fall through to DB
    }
  }
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  await redis.set(cacheKey, JSON.stringify(row), 'EX', USER_CACHE_TTL_SECONDS).catch(() => {});
  return row;
}

async function touchLastSeen(sid: string): Promise<void> {
  // Only write once per throttle window (Redis NX guard) to avoid a DB write per request.
  const ok = await redis
    .set(keys.sessionLastSeen(sid), '1', 'EX', SESSION_LAST_SEEN_THROTTLE_SECONDS, 'NX')
    .catch(() => null);
  if (ok === 'OK') {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, sid))
      .catch(() => {});
  }
}
