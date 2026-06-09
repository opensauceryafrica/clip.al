'use server';

import { isReservedSlug, keys, redis } from '@clipal/cache';
import { CUSTOM_SLUG_HISTORY_MAX } from '@clipal/config/constants';
import { and, db, eq, links, or, recordAudit, sql } from '@clipal/db';
import { checkBlocklist, scanUrl, validateDestination } from '@clipal/safety';
import { rollPreviousCodes, validateCustomSlug } from '@clipal/shorten';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormActionState } from '@/lib/action-state';
import { requireUser } from '@/lib/auth';

/** Load a link the current user owns, or null. */
async function ownedLink(linkId: string, userId: string) {
  const [row] = await db
    .select({
      id: links.id,
      code: links.code,
      previousCodes: links.previousCodes,
      status: links.status,
      destinationUrl: links.destinationUrl,
    })
    .from(links)
    .where(and(eq(links.id, linkId), eq(links.ownerId, userId)))
    .limit(1);
  return row ?? null;
}

export async function editDestinationAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const linkId = String(formData.get('linkId') ?? '');
  const destination = String(formData.get('destination') ?? '');

  const link = await ownedLink(linkId, user.id);
  if (!link) return { error: 'Link not found.' };

  const syntax = validateDestination(destination);
  if (!syntax.ok) return { error: syntax.message };

  // No-op if the normalized destination is unchanged — nothing to re-check.
  if (syntax.value.url === link.destinationUrl) return { ok: true };

  // Unified blocklist check — same semantics as createLink, so editing a link to
  // a blocked domain/keyword can't bypass it. 'reject' refuses the edit; 'flag'
  // allows it but marks the link suspicious for admin review.
  const block = await checkBlocklist(syntax.value.host, syntax.value.etld1, syntax.value.sld);
  if (block.action === 'reject') {
    await recordAudit(db, {
      actorId: user.id,
      action: 'link.blocked',
      targetType: 'link',
      targetId: linkId,
      metadata: { code: link.code, matched: block.value, destination: syntax.value.url },
    });
    return { error: 'That destination is blocked on clip.al.' };
  }
  const flaggedForReview = block.action === 'flag';

  const scan = await scanUrl(syntax.value.url);
  if (scan.state === 'malicious') {
    return { error: 'That destination was flagged as unsafe.' };
  }

  // A blocklist flag forces 'suspicious' (queued for review); else trust the scan.
  const safetyState = flaggedForReview ? 'suspicious' : scan.state;

  await db
    .update(links)
    .set({
      destinationUrl: syntax.value.url,
      safetyState,
      safetyThreats: scan.threats.length > 0 ? scan.threats : null,
      safetyCheckedAt: safetyState === 'unchecked' ? null : new Date(),
    })
    .where(eq(links.id, linkId));

  if (flaggedForReview) {
    await recordAudit(db, {
      actorId: user.id,
      action: 'link.flagged_brand',
      targetType: 'link',
      targetId: linkId,
      metadata: {
        code: link.code,
        destination: syntax.value.url,
        ...(block.action === 'flag' ? { matched: block.value } : {}),
      },
    });
  }

  // Invalidate the hot cache so the next redirect reflects the new URL + state.
  await redis.del(keys.hotLink(link.code)).catch(() => {});
  revalidatePath(`/links/${linkId}`);
  return { ok: true };
}

/**
 * Change a link's back-half (custom slug). Renames `links.code`:
 *  - the OLD short URL stops resolving (its hot-cache entry is dropped);
 *  - analytics keep accumulating under the NEW code (ClickHouse is keyed by code,
 *    so past clicks stay attributed to the old code — the UI warns about this).
 * Validated for format (validateCustomSlug), reserved words, and uniqueness.
 */
export async function changeSlugAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const linkId = String(formData.get('linkId') ?? '');

  const link = await ownedLink(linkId, user.id);
  if (!link) return { error: 'Link not found.' };

  const parsed = validateCustomSlug(String(formData.get('code') ?? ''));
  if (!parsed.ok) return { error: parsed.reason };
  const code = parsed.value;

  if (code === link.code) return { ok: true }; // unchanged — no-op

  // Reserved words (app routes, brand/handle squatting) — case-insensitive set.
  if (await isReservedSlug(code)) return { error: 'That back-half is reserved.' };

  // Taken if it's another link's current code OR one of its old back-halves
  // (aliases still redirect, so they can't be re-registered). Reclaiming THIS
  // link's own old back-half is allowed (it's just promoted back to primary).
  const [holder] = await db
    .select({ id: links.id })
    .from(links)
    .where(or(eq(links.code, code), sql`${links.previousCodes} @> ARRAY[${code}]::text[]`))
    .limit(1);
  if (holder && holder.id !== linkId) return { error: 'That back-half is already taken.' };

  // Keep the retired back-half as an alias (capped); drop the new one if it was
  // a prior alias of this link.
  const previousCodes = rollPreviousCodes(
    link.previousCodes,
    link.code,
    code,
    CUSTOM_SLUG_HISTORY_MAX,
  );

  try {
    await db.update(links).set({ code, previousCodes }).where(eq(links.id, linkId));
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return { error: 'That back-half is already taken.' };
    }
    throw err;
  }

  // Re-resolve both codes fresh: the new code resolves exactly; the old one now
  // resolves via the alias lookup (so it keeps redirecting here).
  await redis.del(keys.hotLink(link.code)).catch(() => {});
  await redis.del(keys.hotLink(code)).catch(() => {});
  revalidatePath(`/links/${linkId}`);
  return { ok: true };
}

export async function setLinkStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const linkId = String(formData.get('linkId') ?? '');
  const action = String(formData.get('action') ?? '');

  const link = await ownedLink(linkId, user.id);
  if (!link) redirect('/links');

  if (action === 'disable') {
    await db.update(links).set({ status: 'disabled_by_user' }).where(eq(links.id, linkId));
    await redis.set(keys.hotLink(link.code), 'DISABLED', 'EX', 300).catch(() => {});
  } else if (action === 'enable') {
    await db.update(links).set({ status: 'active' }).where(eq(links.id, linkId));
    await redis.del(keys.hotLink(link.code)).catch(() => {});
  }
  revalidatePath(`/links/${linkId}`);
}

export async function deleteLinkAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const linkId = String(formData.get('linkId') ?? '');

  const link = await ownedLink(linkId, user.id);
  if (link) {
    await db.delete(links).where(eq(links.id, linkId));
    await redis.set(keys.hotLink(link.code), 'DISABLED', 'EX', 300).catch(() => {});
  }
  redirect('/links');
}
