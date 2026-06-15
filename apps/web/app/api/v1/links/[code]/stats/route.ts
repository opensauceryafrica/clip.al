import { planLimits, resolvePlan } from '@clipal/billing';
import { linkClicksByDay, linkTopCountries, linkTopReferrers } from '@clipal/ch';
import { authenticateApiRequest } from '@/lib/api-auth';
import { apiError, apiJson, authFailureResponse } from '@/lib/api-response';
import { findOwnedLink } from '@/lib/api-links';

/**
 * GET /api/v1/links/:code/stats  (analytics:read)
 *
 * Aggregated analytics for the caller's link: human click totals for today / 7d
 * / 30d plus top countries and referrers. Lookback windows are clamped to the
 * plan's analytics retention (spec §5). Spans renames via `previousCodes`.
 */
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
): Promise<Response> {
  const auth = await authenticateApiRequest(request, 'analytics:read');
  if (!auth.ok) return authFailureResponse(auth);

  const { code } = await ctx.params;
  const link = await findOwnedLink(code, auth.user.id);
  if (!link) return apiError('not_found', 'No link with that code.');

  const plan = await resolvePlan(auth.user.id);
  const retention = planLimits(plan).analyticsRetentionDays;
  const window30 = Math.min(30, retention);
  const window7 = Math.min(7, retention);

  const codes = [link.code, ...link.previousCodes];

  // One 30d day-bucket query feeds today/7d/30d totals; two top-N queries for
  // the breakdowns. All filter is_bot=0 inside ClickHouse.
  const [byDay, byCountry, byReferrer] = await Promise.all([
    linkClicksByDay(codes, window30),
    linkTopCountries(codes, window30, 10),
    linkTopReferrers(codes, window30, 10),
  ]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const cutoff7 = Date.now() - window7 * 24 * 60 * 60 * 1000;

  let today = 0;
  let last7 = 0;
  let last30 = 0;
  for (const row of byDay) {
    const clicks = Number(row.clicks);
    last30 += clicks;
    if (row.day === todayStr) today += clicks;
    if (new Date(row.day + 'T00:00:00Z').getTime() >= cutoff7) last7 += clicks;
  }

  return apiJson({
    code: link.code,
    clicksTotal: link.clicksTotal,
    totals: { today, last7d: last7, last30d: last30 },
    byCountry: byCountry.map((c) => ({ country: c.name, clicks: Number(c.clicks) })),
    byReferrer: byReferrer.map((r) => ({ referrer: r.name, clicks: Number(r.clicks) })),
    retentionDays: retention,
  });
}
