import { getLinkUsage, planLimits, resolvePlan } from '@clipal/billing';
import { redis } from '@clipal/cache';
import { authenticateApiRequest } from '@/lib/api-auth';
import { apiJson, authFailureResponse } from '@/lib/api-response';

/**
 * GET /api/v1/me  (no extra scope — any valid key)
 *
 * The authenticated account's plan and current-month quota usage: links created
 * and API requests consumed, each against its plan limit. Mirrors the buckets
 * `@clipal/billing` (links) and `lib/api-auth` (API requests) maintain.
 */
export const runtime = 'nodejs';

/** UTC `YYYYMM` — matches the bucket keying in lib/api-auth and billing/usage. */
function monthBucket(at: Date): string {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth() + 1;
  return `${y}${m < 10 ? '0' : ''}${m}`;
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return authFailureResponse(auth);

  const now = new Date();
  const plan = await resolvePlan(auth.user.id);
  const limits = planLimits(plan);

  const linksUsed = await getLinkUsage(auth.user.id, now);

  // The API-request bucket is INCR'd by authenticateApiRequest (this very call is
  // already counted). Read it directly; absent/Redis-down reads as 0.
  let apiRequestsUsed = 0;
  try {
    const raw = await redis.get(`usage:api:${auth.user.id}:${monthBucket(now)}`);
    apiRequestsUsed = raw ? Number(raw) : 0;
  } catch {
    apiRequestsUsed = 0;
  }

  return apiJson({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      displayName: auth.user.displayName,
    },
    plan,
    scopes: auth.key.scopes,
    usage: {
      period: monthBucket(now),
      links: { used: linksUsed, limit: limits.linksPerMonth },
      apiRequests: { used: apiRequestsUsed, limit: limits.apiRequestsPerMonth },
      webhooks: { limit: limits.webhooks },
      customDomains: { limit: limits.customDomains },
    },
  });
}
