import { redis } from '@clipal/cache';
import type { PlanName } from '@clipal/config';
import { db, eq, schema } from '@clipal/db';

/** Short-TTL cache for resolved plans, mirroring the user-record cache. */
const PLAN_CACHE_TTL_SECONDS = 60;

function planCacheKey(userId: string): string {
  return `plan:${userId}`;
}

/**
 * Resolves a user's EFFECTIVE plan. A user is on their subscription plan only
 * while it is genuinely active; otherwise they fall back to `free`:
 *  - no subscription row → free
 *  - status `expired` / `past_due` → free
 *  - status `cancelled` AND the paid period has already elapsed → free
 *    (a cancellation set to take effect at period end keeps the plan until then)
 *  - `current_period_end` in the past → free (the period lapsed before renewal)
 *
 * Results are cached in Redis for ~60s (best-effort; cache failures degrade to a
 * direct DB read). Mutations to a subscription should `bustPlanCache(userId)`.
 */
export async function resolvePlan(userId: string): Promise<PlanName> {
  const cacheKey = planCacheKey(userId);
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached === 'free' || cached === 'pro' || cached === 'business') return cached;

  const plan = await computePlan(userId);
  await redis.set(cacheKey, plan, 'EX', PLAN_CACHE_TTL_SECONDS).catch(() => {});
  return plan;
}

async function computePlan(userId: string): Promise<PlanName> {
  const [row] = await db
    .select({
      plan: schema.subscriptions.plan,
      status: schema.subscriptions.status,
      currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
    })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .limit(1);

  if (!row) return 'free';
  if (row.plan === 'free') return 'free';

  // Hard-dead states never grant a paid plan.
  if (row.status === 'expired' || row.status === 'past_due') return 'free';

  // A lapsed paid period means the grant has ended, regardless of status.
  if (row.currentPeriodEnd && row.currentPeriodEnd.getTime() <= Date.now()) return 'free';

  // `cancelled` keeps the plan until the (still-future) period end above; once
  // that has passed the check above already downgraded to free.
  return row.plan;
}

/** Drops the cached plan for a user (call after any subscription mutation). */
export async function bustPlanCache(userId: string): Promise<void> {
  await redis.del(planCacheKey(userId)).catch(() => {});
}
