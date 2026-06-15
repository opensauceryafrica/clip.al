import { redis } from '@clipal/cache';
import { adsPlacements, db, eq, sql } from '@clipal/db';
import { captureException } from '@clipal/observability';

/**
 * Ad impression beacon (spec §10 + §14.7).
 *
 * POST /api/ads/impression/:id — records one impression for a sponsored
 * placement and returns 204 No Content. Called from <AdSlot> via
 * navigator.sendBeacon (POST). The GET branch serves a 1×1 GIF so the no-JS
 * <img> fallback beacon counts too.
 *
 * Counting strategy: a fast Redis HINCRBY for the hot path plus a best-effort
 * Postgres UPDATE so the placement's `impressions` column is durable even
 * without a worker drain. Both are best-effort — a beacon must never error the
 * page. Always 204 (even on a bad id or a backend blip): the beacon is
 * fire-and-forget and we don't leak whether an id exists.
 *
 * Runtime: nodejs (needs the pg/ioredis clients).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ADS_COUNTER_KEY = 'ads:impressions';

async function record(id: string): Promise<void> {
  if (!isUuid(id)) return;

  // Hot counter (cheap, fire-and-forget).
  redis.hincrby(ADS_COUNTER_KEY, id, 1).catch(() => {
    /* a Redis blip must never surface on the beacon path */
  });

  // Durable count on the placement row (only for active placements).
  try {
    await db
      .update(adsPlacements)
      .set({ impressions: sql`${adsPlacements.impressions} + 1` })
      .where(eq(adsPlacements.id, id));
  } catch (err) {
    captureException(err, { where: 'ads.impression', id });
  }
}

export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  await record(id);
  return new Response(null, { status: 204 });
}

// Some no-JS / strict-CSP environments can only fire an <img> (GET) beacon.
// Accept it too, returning a 1×1 transparent GIF.
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  await record(id);
  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'no-store, max-age=0',
      'content-length': String(TRANSPARENT_GIF.length),
    },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

// 1×1 transparent GIF.
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);
