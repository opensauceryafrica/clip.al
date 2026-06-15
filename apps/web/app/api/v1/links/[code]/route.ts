import { keys, redis } from '@clipal/cache';
import { db, eq, recordAudit, schema } from '@clipal/db';
import { validateDestination } from '@clipal/safety';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { apiError, apiJson, authFailureResponse, validate } from '@/lib/api-response';
import { findOwnedLink, serializeLink } from '@/lib/api-links';
import { emitWebhook } from '@/lib/webhooks';

/**
 * Single-link endpoints, all scoped to the authenticated key's owner.
 *   GET    /api/v1/links/:code  (links:read)
 *   PATCH  /api/v1/links/:code  (links:write) — destination / maxClicks / expiry edits
 *   DELETE /api/v1/links/:code  (links:write) — soft-delete (status=disabled_by_user)
 *
 * Any code the caller doesn't own resolves to 404 (no existence leak).
 */
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ code: string }> };

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const auth = await authenticateApiRequest(request, 'links:read');
  if (!auth.ok) return authFailureResponse(auth);

  const { code } = await ctx.params;
  const link = await findOwnedLink(code, auth.user.id);
  if (!link) return apiError('not_found', 'No link with that code.');

  return apiJson({ link: serializeLink(link) });
}

const patchSchema = z
  .object({
    destination: z.string().url().max(2048).optional(),
    maxClicks: z.number().int().positive().max(1_000_000_000).nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'Provide at least one field to update.' });

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const auth = await authenticateApiRequest(request, 'links:write');
  if (!auth.ok) return authFailureResponse(auth);

  const { code } = await ctx.params;
  const link = await findOwnedLink(code, auth.user.id);
  if (!link) return apiError('not_found', 'No link with that code.');

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError('invalid_request', 'Request body must be valid JSON.');
  }
  const parsed = validate(patchSchema, json);
  if (!parsed.ok) return parsed.response;
  const input = parsed.value;

  const updates: Partial<schema.Link> = {};

  if (input.destination !== undefined) {
    // Re-validate the new destination through the same syntax/SSRF guard used at
    // creation; persist the normalized URL so stored links stay canonical.
    const syntax = validateDestination(input.destination);
    if (!syntax.ok) return apiError('invalid_request', syntax.message);
    updates.destinationUrl = syntax.value.url;
  }
  if (input.maxClicks !== undefined) updates.maxClicks = input.maxClicks;
  if (input.expiresAt !== undefined) {
    if (input.expiresAt === null) {
      updates.expiresAt = null;
    } else {
      const when = new Date(input.expiresAt);
      if (when.getTime() <= Date.now()) {
        return apiError('invalid_request', '`expiresAt` must be in the future.');
      }
      updates.expiresAt = when;
    }
  }

  const [updated] = await db
    .update(schema.links)
    .set(updates)
    .where(eq(schema.links.id, link.id))
    .returning();
  if (!updated) return apiError('not_found', 'No link with that code.');

  // The redirect hot-path caches resolved links; bust it so the new destination
  // (and any expiry/cap change) takes effect immediately.
  await redis.del(keys.hotLink(updated.code)).catch(() => {});

  await recordAudit(db, {
    actorId: auth.user.id,
    action: 'link.updated',
    targetType: 'link',
    targetId: updated.id,
    metadata: { code: updated.code, via: 'api', fields: Object.keys(updates) },
  });

  void emitWebhook(auth.user.id, 'link.updated', { code: updated.code, fields: Object.keys(updates) });

  return apiJson({ link: serializeLink(updated) });
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const auth = await authenticateApiRequest(request, 'links:write');
  if (!auth.ok) return authFailureResponse(auth);

  const { code } = await ctx.params;
  const link = await findOwnedLink(code, auth.user.id);
  if (!link) return apiError('not_found', 'No link with that code.');

  // Soft delete: flip status and bust the hot cache (DISABLED sentinel handled
  // on next resolve). Audit trail records who disabled it via the API.
  await db
    .update(schema.links)
    .set({ status: 'disabled_by_user' })
    .where(eq(schema.links.id, link.id));

  await redis.set(keys.hotLink(link.code), 'DISABLED', 'EX', 3600).catch(() => {});

  await recordAudit(db, {
    actorId: auth.user.id,
    action: 'link.disabled',
    targetType: 'link',
    targetId: link.id,
    metadata: { code: link.code, via: 'api' },
  });

  void emitWebhook(auth.user.id, 'link.deleted', { code: link.code });

  return apiJson({ deleted: true, code: link.code });
}
