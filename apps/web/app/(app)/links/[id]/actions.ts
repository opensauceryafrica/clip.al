'use server';

import { keys, redis } from '@clipal/cache';
import { and, db, eq, links, recordAudit } from '@clipal/db';
import { checkBrandTerms, isBlockedDomain, scanUrl, validateDestination } from '@clipal/safety';
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

  if (await isBlockedDomain(syntax.value.etld1)) {
    return { error: 'That domain is blocked on clip.al.' };
  }

  // Brand/trademark check — same semantics as createLink (§14.13), so editing a
  // link to a lookalike can't bypass the brand-term system. 'reject' refuses the
  // edit; 'flag' allows it but marks the link suspicious for admin review.
  const brand = await checkBrandTerms(syntax.value.host, syntax.value.sld);
  if (brand.matched && brand.policy === 'reject') {
    await recordAudit(db, {
      actorId: user.id,
      action: 'link.brand_blocked',
      targetType: 'link',
      targetId: linkId,
      metadata: { code: link.code, term: brand.term, policy: 'reject', destination: syntax.value.url },
    });
    return { error: 'That destination impersonates a protected brand and can’t be used.' };
  }
  const brandFlag = brand.matched; // any remaining match is a soft 'flag'

  const scan = await scanUrl(syntax.value.url);
  if (scan.state === 'malicious') {
    return { error: 'That destination was flagged as unsafe.' };
  }

  // A brand flag forces 'suspicious' (queued for review); otherwise trust the scan.
  const safetyState = brandFlag ? 'suspicious' : scan.state;

  await db
    .update(links)
    .set({
      destinationUrl: syntax.value.url,
      safetyState,
      safetyThreats: scan.threats.length > 0 ? scan.threats : null,
      safetyCheckedAt: safetyState === 'unchecked' ? null : new Date(),
    })
    .where(eq(links.id, linkId));

  if (brandFlag) {
    await recordAudit(db, {
      actorId: user.id,
      action: 'link.flagged_brand',
      targetType: 'link',
      targetId: linkId,
      metadata: {
        code: link.code,
        destination: syntax.value.url,
        ...(brand.matched ? { term: brand.term, policy: 'flag' } : {}),
      },
    });
  }

  // Invalidate the hot cache so the next redirect reflects the new URL + state.
  await redis.del(keys.hotLink(link.code)).catch(() => {});
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
