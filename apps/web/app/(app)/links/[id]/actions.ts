'use server';

import { hashPassword } from '@clipal/auth';
import {
  isPlanRequiredError,
  requireFeature,
  resolvePlan,
} from '@clipal/billing';
import { isReservedSlug, keys, redis } from '@clipal/cache';
import { CUSTOM_SLUG_HISTORY_MAX } from '@clipal/config/constants';
import type { Feature } from '@clipal/config';
import type { DestinationMatch } from '@clipal/db';
import {
  and,
  campaigns,
  db,
  eq,
  linkDestinations,
  links,
  or,
  recordAudit,
  sql,
} from '@clipal/db';
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

// ── Power-link edit actions (§8) ─────────────────────────────────────────────
// Each: requireUser + own-the-link (else 'Link not found.'), plan-gate the
// relevant feature, update the power column(s), recordAudit, then invalidate the
// hot cache for the current code AND every retired alias so the resolver re-reads
// from Postgres. `revalidatePath` refreshes the detail page.

/** Map a PlanRequiredError to a FormActionState; rethrow anything else. */
function planError(err: unknown): FormActionState {
  if (isPlanRequiredError(err)) return { error: err.message };
  throw err;
}

/** Drop the hot-cache entry for the link's current code and all previous codes. */
async function invalidateAllCodes(code: string, previousCodes: readonly string[]): Promise<void> {
  const all = [code, ...previousCodes];
  await Promise.all(all.map((c) => redis.del(keys.hotLink(c)).catch(() => {})));
}

/**
 * Set or rotate a link's password (gated: `password`). Hashes with argon2id and
 * writes `password_hash` (presence => protected). Empty input is rejected — use
 * {@link removeLinkPasswordAction} to clear.
 */
export async function setLinkPasswordAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const linkId = String(formData.get('linkId') ?? '');
  const password = String(formData.get('password') ?? '');

  const link = await ownedLink(linkId, user.id);
  if (!link) return { error: 'Link not found.' };
  if (!password) return { error: 'Enter a password.' };

  try {
    requireFeature(await resolvePlan(user.id), 'password');
  } catch (err) {
    return planError(err);
  }

  const passwordHash = await hashPassword(password);
  await db.update(links).set({ passwordHash }).where(eq(links.id, linkId));

  await recordAudit(db, {
    actorId: user.id,
    action: 'link.password_set',
    targetType: 'link',
    targetId: linkId,
    metadata: { code: link.code },
  });

  await invalidateAllCodes(link.code, link.previousCodes);
  revalidatePath(`/links/${linkId}`);
  return { ok: true };
}

/** Remove a link's password (clears `password_hash`). No plan gate to remove. */
export async function removeLinkPasswordAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const linkId = String(formData.get('linkId') ?? '');

  const link = await ownedLink(linkId, user.id);
  if (!link) return { error: 'Link not found.' };

  await db.update(links).set({ passwordHash: null }).where(eq(links.id, linkId));

  await recordAudit(db, {
    actorId: user.id,
    action: 'link.password_removed',
    targetType: 'link',
    targetId: linkId,
    metadata: { code: link.code },
  });

  await invalidateAllCodes(link.code, link.previousCodes);
  revalidatePath(`/links/${linkId}`);
  return { ok: true };
}

/**
 * Set or clear a link's expiry date (gated: `expiry`). `expiresAt` empty clears;
 * otherwise it must be a future ISO timestamp.
 */
export async function setLinkExpiryAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const linkId = String(formData.get('linkId') ?? '');
  const expiresAtRaw = String(formData.get('expiresAt') ?? '').trim();

  const link = await ownedLink(linkId, user.id);
  if (!link) return { error: 'Link not found.' };

  let expiresAt: Date | null = null;
  if (expiresAtRaw) {
    try {
      requireFeature(await resolvePlan(user.id), 'expiry');
    } catch (err) {
      return planError(err);
    }
    const ts = Date.parse(expiresAtRaw);
    if (Number.isNaN(ts)) return { error: 'Expiry date is invalid.' };
    if (ts <= Date.now()) return { error: 'Expiry must be in the future.' };
    expiresAt = new Date(ts);
  }

  await db.update(links).set({ expiresAt }).where(eq(links.id, linkId));

  await recordAudit(db, {
    actorId: user.id,
    action: expiresAt ? 'link.expiry_set' : 'link.expiry_cleared',
    targetType: 'link',
    targetId: linkId,
    metadata: { code: link.code, ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}) },
  });

  await invalidateAllCodes(link.code, link.previousCodes);
  revalidatePath(`/links/${linkId}`);
  return { ok: true };
}

/**
 * Set or clear a link's click limit (gated: `expiry`). `maxClicks` empty clears;
 * otherwise a positive integer. Also drops the Redis click-limit counter so the
 * new cap (or its absence) re-seeds from the link's denormalized total.
 */
export async function setLinkMaxClicksAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const linkId = String(formData.get('linkId') ?? '');
  const maxClicksRaw = String(formData.get('maxClicks') ?? '').trim();

  const link = await ownedLink(linkId, user.id);
  if (!link) return { error: 'Link not found.' };

  let maxClicks: number | null = null;
  if (maxClicksRaw) {
    try {
      requireFeature(await resolvePlan(user.id), 'expiry');
    } catch (err) {
      return planError(err);
    }
    const n = Number(maxClicksRaw);
    if (!Number.isInteger(n) || n <= 0) {
      return { error: 'Click limit must be a positive whole number.' };
    }
    maxClicks = n;
  }

  await db.update(links).set({ maxClicks }).where(eq(links.id, linkId));

  await recordAudit(db, {
    actorId: user.id,
    action: maxClicks === null ? 'link.max_clicks_cleared' : 'link.max_clicks_set',
    targetType: 'link',
    targetId: linkId,
    metadata: { code: link.code, ...(maxClicks === null ? {} : { maxClicks }) },
  });

  await invalidateAllCodes(link.code, link.previousCodes);
  // Reset the click-limit counter so the next click re-seeds against the new cap.
  await redis.del(keys.clickLimit(link.code)).catch(() => {});
  revalidatePath(`/links/${linkId}`);
  return { ok: true };
}

const ROUTING_MODES = ['single', 'geo', 'device', 'ab'] as const;
const DEVICE_CLASSES = ['mobile', 'tablet', 'desktop', 'bot'] as const;
type EditRoutingMode = (typeof ROUTING_MODES)[number];

const ROUTING_FEATURE: Record<Exclude<EditRoutingMode, 'single'>, Feature> = {
  geo: 'geoRouting',
  device: 'deviceRouting',
  ab: 'abTesting',
};

/** Parse + validate `rules` JSON into rows ready for `link_destinations`. */
function parseRoutingRules(
  raw: string,
  mode: Exclude<EditRoutingMode, 'single'>,
):
  | { ok: true; rows: { match: DestinationMatch; destinationUrl: string; order: number }[] }
  | { ok: false; error: string } {
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Routing rules are malformed.' };
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    return { ok: false, error: 'Add at least one routing destination.' };
  }

  const rows: { match: DestinationMatch; destinationUrl: string; order: number }[] = [];
  let abWeightTotal = 0;
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i] as Record<string, unknown>;
    const url = typeof r?.url === 'string' ? r.url.trim() : '';
    if (!url) return { ok: false, error: 'Each routing rule needs a destination URL.' };
    const m = r?.match as Record<string, unknown> | undefined;
    if (!m || typeof m !== 'object') return { ok: false, error: 'Each rule needs a match.' };

    let match: DestinationMatch;
    if (mode === 'geo') {
      const countries = Array.isArray(m.countries)
        ? m.countries.filter((c): c is string => typeof c === 'string').map((c) => c.toUpperCase())
        : [];
      if (countries.length === 0) return { ok: false, error: 'Geo rules need at least one country.' };
      match = { type: 'geo', countries };
    } else if (mode === 'device') {
      const device = m.device;
      if (typeof device !== 'string' || !(DEVICE_CLASSES as readonly string[]).includes(device)) {
        return { ok: false, error: 'Device rules need a valid device class.' };
      }
      match = { type: 'device', device: device as (typeof DEVICE_CLASSES)[number] };
    } else {
      const weight = Number(m.weight);
      if (!Number.isFinite(weight) || weight < 0) {
        return { ok: false, error: 'A/B weights must be non-negative numbers.' };
      }
      abWeightTotal += weight;
      match = { type: 'ab', weight };
    }
    rows.push({ match, destinationUrl: url, order: i });
  }

  if (mode === 'ab' && abWeightTotal <= 0) {
    return { ok: false, error: 'A/B weights must sum to a positive total.' };
  }
  return { ok: true, rows };
}

/**
 * Change a link's routing mode and replace its `link_destinations` rows (gated by
 * the per-mode feature: geoRouting/deviceRouting/abTesting; switching to 'single'
 * needs no gate). The mode change + row replacement run in one transaction so the
 * link is never left routed with no rules.
 */
export async function setLinkRoutingAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const linkId = String(formData.get('linkId') ?? '');
  const modeRaw = String(formData.get('routingMode') ?? '').trim();
  const rulesRaw = String(formData.get('rules') ?? '').trim();

  const link = await ownedLink(linkId, user.id);
  if (!link) return { error: 'Link not found.' };

  if (!(ROUTING_MODES as readonly string[]).includes(modeRaw)) {
    return { error: 'Unknown routing mode.' };
  }
  const mode = modeRaw as EditRoutingMode;

  let rows: { match: DestinationMatch; destinationUrl: string; order: number }[] = [];
  if (mode !== 'single') {
    try {
      requireFeature(await resolvePlan(user.id), ROUTING_FEATURE[mode]);
    } catch (err) {
      return planError(err);
    }
    const parsed = parseRoutingRules(rulesRaw, mode);
    if (!parsed.ok) return { error: parsed.error };
    rows = parsed.rows;
  }

  await db.transaction(async (tx) => {
    await tx.update(links).set({ routingMode: mode }).where(eq(links.id, linkId));
    await tx.delete(linkDestinations).where(eq(linkDestinations.linkId, linkId));
    if (rows.length > 0) {
      await tx
        .insert(linkDestinations)
        .values(rows.map((r) => ({ linkId, match: r.match, destinationUrl: r.destinationUrl, order: r.order })));
    }
  });

  await recordAudit(db, {
    actorId: user.id,
    action: 'link.routing_set',
    targetType: 'link',
    targetId: linkId,
    metadata: { code: link.code, routingMode: mode, rules: rows.length },
  });

  await invalidateAllCodes(link.code, link.previousCodes);
  revalidatePath(`/links/${linkId}`);
  return { ok: true };
}

/**
 * Assign or clear a link's campaign. `campaignId` empty clears the association;
 * otherwise it must reference a campaign the user owns (else 'Campaign not found.').
 * No feature gate (A/B gating is enforced when routing is set).
 */
export async function assignLinkCampaignAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const linkId = String(formData.get('linkId') ?? '');
  const campaignId = String(formData.get('campaignId') ?? '').trim();

  const link = await ownedLink(linkId, user.id);
  if (!link) return { error: 'Link not found.' };

  if (campaignId) {
    const [camp] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
      .limit(1);
    if (!camp) return { error: 'Campaign not found.' };
  }

  await db
    .update(links)
    .set({ campaignId: campaignId || null })
    .where(eq(links.id, linkId));

  await recordAudit(db, {
    actorId: user.id,
    action: campaignId ? 'link.campaign_assigned' : 'link.campaign_cleared',
    targetType: 'link',
    targetId: linkId,
    metadata: { code: link.code, ...(campaignId ? { campaignId } : {}) },
  });

  await invalidateAllCodes(link.code, link.previousCodes);
  revalidatePath(`/links/${linkId}`);
  return { ok: true };
}
