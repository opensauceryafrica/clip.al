import { planLimits, resolvePlan } from '@clipal/billing';
import { linkRecentClicks } from '@clipal/ch';
import { authenticateApiRequest } from '@/lib/api-auth';
import { apiError, apiJson, authFailureResponse } from '@/lib/api-response';
import { findOwnedLink } from '@/lib/api-links';

/**
 * GET /api/v1/links/:code/clicks  (analytics:read)
 *
 * Recent raw click events for the caller's link (and any previous back-halves),
 * most-recent-first. `limit` is clamped to ≤500. Result rows are capped to the
 * plan's analytics retention window AND a hard 90-day ceiling (spec §5).
 */
export const runtime = 'nodejs';

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
const HARD_RETENTION_DAYS = 90;

export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
): Promise<Response> {
  const auth = await authenticateApiRequest(request, 'analytics:read');
  if (!auth.ok) return authFailureResponse(auth);

  const { code } = await ctx.params;
  const link = await findOwnedLink(code, auth.user.id);
  if (!link) return apiError('not_found', 'No link with that code.');

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;

  const plan = await resolvePlan(auth.user.id);
  const retentionDays = Math.min(planLimits(plan).analyticsRetentionDays, HARD_RETENTION_DAYS);

  // Analytics span renames: include the link's current code plus historical ones.
  const codes = [link.code, ...link.previousCodes];

  // ClickHouse returns recent events; filter to the retention window app-side so
  // the cap is enforced even though `linkRecentClicks` is purely most-recent-N.
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const rows = await linkRecentClicks(codes, limit);
  const clicks = rows.filter((r) => new Date(r.ts + 'Z').getTime() >= cutoff);

  return apiJson({
    code: link.code,
    retentionDays,
    data: clicks,
  });
}
