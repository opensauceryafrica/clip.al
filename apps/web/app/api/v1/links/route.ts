import { can, resolvePlan } from '@clipal/billing';
import { and, asc, db, eq, gt, or, schema } from '@clipal/db';
import { createLink } from '@clipal/shorten';
import { emitWebhook } from '@/lib/webhooks';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  apiError,
  apiJson,
  authFailureResponse,
  decodeCursor,
  encodeCursor,
  parseLimit,
  replayIdempotent,
  storeIdempotent,
  validate,
} from '@/lib/api-response';
import { serializeLink } from '@/lib/api-links';
import { getClientIp, getUserAgent } from '@/lib/request';

/**
 * Collection endpoint for links.
 *   POST  /api/v1/links  (links:write) — create a link with optional power options.
 *   GET   /api/v1/links  (links:read)  — cursor-paginated list of the caller's links.
 *
 * Both are scoped to the authenticated key's owner. Creation routes through the
 * same `@clipal/shorten` pipeline the dashboard uses (safety + slug allocation),
 * with power options plan-gated here (the pipeline trusts entitlement to callers).
 */
export const runtime = 'nodejs';

const createSchema = z
  .object({
    destination: z.string().url().max(2048),
    customSlug: z.string().min(1).max(64).optional(),
    expiresAt: z.string().datetime().optional(),
    maxClicks: z.number().int().positive().max(1_000_000_000).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, 'links:write');
  if (!auth.ok) return authFailureResponse(auth);

  const idempotencyKey = request.headers.get('idempotency-key');
  const replay = await replayIdempotent(auth.user.id, idempotencyKey);
  if (replay) return replay;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError('invalid_request', 'Request body must be valid JSON.');
  }

  const parsed = validate(createSchema, json);
  if (!parsed.ok) return parsed.response;
  const input = parsed.value;

  // Plan-gate the power options the dashboard server action also gates.
  const plan = await resolvePlan(auth.user.id);
  if (input.customSlug && !can(plan, 'customSlugs')) {
    return apiError('plan_required', 'Custom back-halves are not available on your plan.', { plan });
  }
  if ((input.expiresAt || input.maxClicks) && !can(plan, 'expiry')) {
    return apiError('plan_required', 'Expiring links are not available on your plan.', { plan });
  }

  let expiresAt: Date | undefined;
  if (input.expiresAt) {
    const when = new Date(input.expiresAt);
    if (when.getTime() <= Date.now()) {
      return apiError('invalid_request', '`expiresAt` must be in the future.');
    }
    expiresAt = when;
  }

  const power =
    input.customSlug || expiresAt || input.maxClicks
      ? {
          ...(input.customSlug ? { customSlug: input.customSlug } : {}),
          ...(expiresAt ? { expiresAt } : {}),
          ...(input.maxClicks ? { maxClicks: input.maxClicks } : {}),
        }
      : undefined;

  const result = await createLink({
    destination: input.destination,
    ownerId: auth.user.id,
    creatorIp: getClientIp(request.headers),
    creatorUserAgent: getUserAgent(request.headers),
    ...(power ? { power } : {}),
  });

  if (!result.ok) {
    // Slug conflicts/invalid back-halves are client errors; blocked/malicious
    // destinations are also caller-correctable input — all map to invalid_request.
    return apiError('invalid_request', result.message, { reason: result.reason });
  }

  const [link] = await db
    .select()
    .from(schema.links)
    .where(eq(schema.links.id, result.id))
    .limit(1);
  if (!link) return apiError('not_found', 'The link could not be loaded after creation.');

  void emitWebhook(auth.user.id, 'link.created', { code: link.code, destination: link.destinationUrl });

  const response = apiJson({ link: serializeLink(link) }, { status: 201 });
  return storeIdempotent(auth.user.id, idempotencyKey, response);
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, 'links:read');
  if (!auth.ok) return authFailureResponse(auth);

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  if (url.searchParams.get('cursor') && !cursor) {
    return apiError('invalid_request', 'The `cursor` parameter is malformed.');
  }

  // Keyset pagination over (updated_at ASC, id ASC). Fetch one extra row to know
  // whether a next page exists without a separate COUNT.
  const ownerFilter = eq(schema.links.ownerId, auth.user.id);
  const where = cursor
    ? and(
        ownerFilter,
        or(
          gt(schema.links.updatedAt, new Date(cursor.updatedAt)),
          and(
            eq(schema.links.updatedAt, new Date(cursor.updatedAt)),
            gt(schema.links.id, cursor.id),
          ),
        ),
      )
    : ownerFilter;

  const rows = await db
    .select()
    .from(schema.links)
    .where(where)
    .orderBy(asc(schema.links.updatedAt), asc(schema.links.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.updatedAt, last.id) : null;

  return apiJson({
    data: page.map(serializeLink),
    pagination: { nextCursor, hasMore },
  });
}
