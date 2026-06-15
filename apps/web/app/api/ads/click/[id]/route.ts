import { redis } from '@clipal/cache';
import { adsPlacements, and, db, eq, sql } from '@clipal/db';
import { captureException } from '@clipal/observability';

/**
 * Ad click handler (spec §10 + §14.7).
 *
 * GET /api/ads/click/:id — the href behind a sponsored creative in <AdSlot>.
 * Validates the id, confirms the placement is ACTIVE, records the click
 * (Redis HINCRBY + durable Postgres UPDATE), then 302-redirects to the
 * placement's stored `clickUrl`.
 *
 * If the id is malformed, unknown, inactive, or its clickUrl isn't a safe
 * absolute http(s) URL, we 302 home (`/`) rather than erroring — a dead ad link
 * shouldn't dump the user on an error page, and we never redirect to a
 * non-http(s) scheme (no open-redirect to javascript:/data: etc.).
 *
 * Runtime: nodejs (needs the pg/ioredis clients).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ADS_CLICK_COUNTER_KEY = 'ads:clicks';

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;

  const dest = await resolveClick(id).catch((err) => {
    captureException(err, { where: 'ads.click', id });
    return null;
  });

  // 302 to the validated absolute destination, else home. A relative `Location`
  // is resolved by the browser against the current origin (the app's own host),
  // which is what we want for the fallback — no need to know APP_URL here.
  return new Response(null, {
    status: 302,
    headers: { location: dest ?? '/', 'cache-control': 'no-store, max-age=0' },
  });
}

/**
 * Atomically bump the click count for an ACTIVE placement and return its
 * (validated) clickUrl, or null if it shouldn't redirect anywhere specific.
 */
async function resolveClick(id: string): Promise<string | null> {
  if (!isUuid(id)) return null;

  // Increment clicks only for active placements; RETURNING gives us the
  // clickUrl in the same round-trip and tells us the row existed + was active.
  const updated = await db
    .update(adsPlacements)
    .set({ clicks: sql`${adsPlacements.clicks} + 1` })
    .where(and(eq(adsPlacements.id, id), eq(adsPlacements.active, true)))
    .returning({ clickUrl: adsPlacements.clickUrl });

  const row = updated[0];
  if (!row) return null;

  // Hot counter (fire-and-forget).
  redis.hincrby(ADS_CLICK_COUNTER_KEY, id, 1).catch(() => {
    /* ignore Redis blip */
  });

  return sanitizeDestination(row.clickUrl);
}

/** Only allow absolute http(s) destinations (guards against open redirects). */
function sanitizeDestination(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    return null;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}
