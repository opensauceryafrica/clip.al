'use server';

import { invalidateUserCache, revokeAllSessions } from '@clipal/auth';
import { applyBillingEvent } from '@clipal/billing';
import { addBlockEntry, keys, redis, removeBlockEntry } from '@clipal/cache';
import {
  currencies,
  getPublicBaseUrl,
  intervals,
  planNames,
  type Currency,
  type Interval,
  type PlanName,
} from '@clipal/config';
import {
  adsPlacements,
  and,
  blockedDomains,
  customDomains,
  db,
  eq,
  linkReports,
  links,
  planPrices,
  recordAudit,
  subscriptions,
  users,
} from '@clipal/db';
import { sendAccountSuspended } from '@clipal/email';
import { registrableDomain } from '@clipal/safety';
import { putObject } from '@clipal/s3';
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { getClientIp, getUserAgent } from '@/lib/request';

async function auditContext(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  return { ip: getClientIp(h), userAgent: getUserAgent(h) };
}

// ---- Links ------------------------------------------------------------------

export async function adminDisableLinkAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const linkId = String(formData.get('linkId') ?? '');
  const [link] = await db.select({ code: links.code }).from(links).where(eq(links.id, linkId)).limit(1);
  if (!link) return;

  await db.update(links).set({ status: 'disabled_by_admin' }).where(eq(links.id, linkId));
  await redis.set(keys.hotLink(link.code), 'DISABLED', 'EX', 300).catch(() => {});
  await recordAudit(db, {
    actorId: admin.id,
    action: 'link.disable',
    targetType: 'link',
    targetId: linkId,
    metadata: { code: link.code },
    ...(await auditContext()),
  });
  revalidatePath('/admin/links');
  revalidatePath(`/admin/links/${linkId}`);
}

export async function adminSetSafetyAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const linkId = String(formData.get('linkId') ?? '');
  const state = String(formData.get('state') ?? '');
  const [link] = await db
    .select({ code: links.code, status: links.status })
    .from(links)
    .where(eq(links.id, linkId))
    .limit(1);
  if (!link) return;

  if (state === 'malicious') {
    await db
      .update(links)
      .set({ safetyState: 'malicious', status: 'disabled_by_safety', safetyCheckedAt: new Date() })
      .where(eq(links.id, linkId));
    await redis.set(keys.hotLink(link.code), 'DISABLED', 'EX', 300).catch(() => {});
  } else if (state === 'clean') {
    await db
      .update(links)
      .set({
        safetyState: 'clean',
        safetyThreats: null,
        safetyCheckedAt: new Date(),
        // Re-activate if it was only off because of the safety system.
        ...(link.status === 'disabled_by_safety' ? { status: 'active' as const } : {}),
      })
      .where(eq(links.id, linkId));
    await redis.del(keys.hotLink(link.code)).catch(() => {});
  } else {
    return;
  }

  await recordAudit(db, {
    actorId: admin.id,
    action: state === 'malicious' ? 'link.mark_malicious' : 'link.mark_safe',
    targetType: 'link',
    targetId: linkId,
    metadata: { code: link.code },
    ...(await auditContext()),
  });
  revalidatePath('/admin/links');
  revalidatePath(`/admin/links/${linkId}`);
}

// ---- Reports ----------------------------------------------------------------

export async function adminDismissReportsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const linkId = String(formData.get('linkId') ?? '');
  const [link] = await db
    .select({ code: links.code, status: links.status })
    .from(links)
    .where(eq(links.id, linkId))
    .limit(1);
  if (!link) return;

  await db.delete(linkReports).where(eq(linkReports.linkId, linkId));
  await db
    .update(links)
    .set({
      reportCount: 0,
      ...(link.status === 'pending_review' ? { status: 'active' as const } : {}),
    })
    .where(eq(links.id, linkId));
  if (link.status === 'pending_review') {
    await redis.del(keys.hotLink(link.code)).catch(() => {});
  }

  await recordAudit(db, {
    actorId: admin.id,
    action: 'report.dismiss',
    targetType: 'link',
    targetId: linkId,
    metadata: { code: link.code },
    ...(await auditContext()),
  });
  revalidatePath('/admin/reports');
}

// ---- Users ------------------------------------------------------------------

export async function adminSuspendUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const [target] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return;

  await db.update(users).set({ status: 'suspended' }).where(eq(users.id, userId));
  await revokeAllSessions(userId);
  await invalidateUserCache(userId);
  await sendAccountSuspended(target.email, {
    reason: reason || undefined,
    contactUrl: `${getPublicBaseUrl()}/help`,
  }).catch((e: unknown) => console.error('[admin] suspend email failed', e));

  await recordAudit(db, {
    actorId: admin.id,
    action: 'user.suspend',
    targetType: 'user',
    targetId: userId,
    metadata: { email: target.email, reason: reason || null },
    ...(await auditContext()),
  });
  revalidatePath('/admin/users');
  revalidatePath('/admin/users/[id]', 'page');
}

export async function adminUnsuspendUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId') ?? '');
  await db.update(users).set({ status: 'active' }).where(eq(users.id, userId));
  await invalidateUserCache(userId);
  await recordAudit(db, {
    actorId: admin.id,
    action: 'user.unsuspend',
    targetType: 'user',
    targetId: userId,
    ...(await auditContext()),
  });
  revalidatePath('/admin/users');
  revalidatePath('/admin/users/[id]', 'page');
}

export async function adminChangeRoleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  // Role changes are admin-only (moderators may not change roles — §14.11).
  if (admin.role !== 'admin') return;
  const userId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? '');
  if (role !== 'user' && role !== 'moderator' && role !== 'admin') return;

  // No-op if the role is unchanged (avoids needlessly logging the user out below).
  const [current] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!current || current.role === role) return;

  await db.update(users).set({ role }).where(eq(users.id, userId));
  await invalidateUserCache(userId);
  // Revoke the target's sessions so the new role takes effect immediately and
  // everywhere: they must re-authenticate, which clears any stale client-side
  // nav/route cache from their previous role. Without this a just-demoted admin
  // keeps seeing the (cached) admin nav until a hard refresh — confusing, even
  // though the server already blocks the actual admin routes per-request.
  await revokeAllSessions(userId);
  await recordAudit(db, {
    actorId: admin.id,
    action: 'user.change_role',
    targetType: 'user',
    targetId: userId,
    metadata: { role, from: current.role },
    ...(await auditContext()),
  });
  revalidatePath('/admin/users');
  revalidatePath('/admin/users/[id]', 'page');
}

// ---- Blocklist (unified: domains + keywords) --------------------------------

export async function adminAddBlockEntryAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const match = String(formData.get('match') ?? 'domain') === 'keyword' ? 'keyword' : 'domain';
  const policy = String(formData.get('policy') ?? 'reject') === 'flag' ? 'flag' : 'reject';
  const reason = String(formData.get('reason') ?? '').trim() || (match === 'keyword' ? 'brand' : 'manual');
  // Domains normalize to eTLD+1; keywords are a lowercased substring.
  const raw = String(formData.get('value') ?? '');
  const value = match === 'domain' ? registrableDomain(raw) : raw.trim().toLowerCase();
  if (!value) return;

  await db
    .insert(blockedDomains)
    .values({ domain: value, match, policy, reason, addedBy: admin.id })
    .onConflictDoUpdate({
      target: blockedDomains.domain,
      set: { match, policy, reason, addedBy: admin.id },
    });
  // Drop from both hashes (in case the match type changed), then add to the right one.
  await removeBlockEntry(value, 'domain');
  await removeBlockEntry(value, 'keyword');
  await addBlockEntry(value, match, policy);

  await recordAudit(db, {
    actorId: admin.id,
    action: 'blocklist.add',
    targetType: 'blocklist',
    targetId: value,
    metadata: { match, policy, reason },
    ...(await auditContext()),
  });
  revalidatePath('/admin/blocklist');
}

export async function adminRemoveBlockEntryAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const value = String(formData.get('value') ?? '')
    .trim()
    .toLowerCase();
  if (!value) return;

  await db.delete(blockedDomains).where(eq(blockedDomains.domain, value));
  await removeBlockEntry(value, 'domain');
  await removeBlockEntry(value, 'keyword');

  await recordAudit(db, {
    actorId: admin.id,
    action: 'blocklist.remove',
    targetType: 'blocklist',
    targetId: value,
    ...(await auditContext()),
  });
  revalidatePath('/admin/blocklist');
}

// ---- Subscriptions ----------------------------------------------------------

/**
 * Admin manual cancel of a user's subscription. Immediate (revokes the paid
 * entitlement now): we apply a `cancel` event with `cancelAtPeriodEnd: false`,
 * which the billing state machine resolves to a hard downgrade to free —
 * crucially WITHOUT destroying the user's preserved power-link configuration
 * (the routing modes are suspended, the destination rows stay). We do not call
 * the provider here (admin override is local-first); the provider webhook
 * reconciles idempotently if the user is also cancelled upstream.
 */
export async function adminCancelSubscriptionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId') ?? '');
  if (!userId) return;

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  if (!sub || sub.plan === 'free') return;

  await applyBillingEvent({
    processor: sub.processor ?? 'paystack',
    type: 'cancel',
    data: {
      userId,
      plan: sub.plan,
      ...(sub.interval ? { interval: sub.interval as Interval } : {}),
      currency: sub.currency as Currency,
      cancelAtPeriodEnd: false,
    },
  });

  await recordAudit(db, {
    actorId: admin.id,
    action: 'subscription.admin_cancel',
    targetType: 'subscription',
    targetId: userId,
    metadata: { plan: sub.plan, processor: sub.processor },
    ...(await auditContext()),
  });
  revalidatePath('/admin/subscriptions');
}

// ---- Pricing (plan_prices overrides) ----------------------------------------

function isPlanName(v: string): v is PlanName {
  return (planNames as readonly string[]).includes(v);
}
function isCurrency(v: string): v is Currency {
  return (currencies as readonly string[]).includes(v);
}
function isInterval(v: string): v is Interval {
  return (intervals as readonly string[]).includes(v);
}

/**
 * Upsert a `plan_prices` override row for a (plan, currency, interval) triple.
 * An active override supersedes the code-default price in `@clipal/config`'s
 * `DEFAULT_PRICES`; `effectivePrice()` reads it fresh from Postgres on every call
 * (there is no separate Redis price cache to bust — plan resolution caches the
 * *plan*, not the price, so a price edit is visible immediately). An empty
 * amount removes the override, falling the price back to the code default.
 *
 * `amountMinor` is in minor units (kobo for NGN, cents for USD).
 */
export async function adminUpsertPlanPriceAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  // Price changes are a financial control — admin-only (moderators excluded).
  if (admin.role !== 'admin') return;

  const plan = String(formData.get('plan') ?? '');
  const currency = String(formData.get('currency') ?? '');
  const interval = String(formData.get('interval') ?? '');
  if (!isPlanName(plan) || plan === 'free') return;
  if (!isCurrency(currency) || !isInterval(interval)) return;

  const amountRaw = String(formData.get('amountMinor') ?? '').trim();

  // Empty value ⇒ delete the override (revert to code default).
  if (amountRaw === '') {
    await db
      .delete(planPrices)
      .where(
        and(
          eq(planPrices.plan, plan),
          eq(planPrices.currency, currency),
          eq(planPrices.interval, interval),
        ),
      );
    await recordAudit(db, {
      actorId: admin.id,
      action: 'pricing.clear_override',
      targetType: 'plan_price',
      targetId: `${plan}:${currency}:${interval}`,
      metadata: { plan, currency, interval },
      ...(await auditContext()),
    });
    revalidatePath('/admin/pricing');
    revalidatePath('/pricing');
    return;
  }

  const amountMinor = Number.parseInt(amountRaw, 10);
  if (!Number.isFinite(amountMinor) || amountMinor < 0) return;

  await db
    .insert(planPrices)
    .values({ plan, currency, interval, amountMinor, active: true })
    .onConflictDoUpdate({
      target: [planPrices.plan, planPrices.currency, planPrices.interval],
      set: { amountMinor, active: true },
    });

  await recordAudit(db, {
    actorId: admin.id,
    action: 'pricing.set_override',
    targetType: 'plan_price',
    targetId: `${plan}:${currency}:${interval}`,
    metadata: { plan, currency, interval, amountMinor },
    ...(await auditContext()),
  });
  revalidatePath('/admin/pricing');
  revalidatePath('/pricing');
}

// ---- Custom domains ---------------------------------------------------------

/**
 * Force a re-check of a custom domain (admin). Clears `lastCheckAt` so the
 * worker re-evaluates it on its next sweep. recordAudit.
 */
export async function adminRecheckDomainAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const domainId = String(formData.get('domainId') ?? '');
  if (!domainId) return;

  const [row] = await db
    .select({ domain: customDomains.domain })
    .from(customDomains)
    .where(eq(customDomains.id, domainId))
    .limit(1);
  if (!row) return;

  await db
    .update(customDomains)
    .set({ lastCheckAt: null })
    .where(eq(customDomains.id, domainId));

  await recordAudit(db, {
    actorId: admin.id,
    action: 'domain.recheck',
    targetType: 'custom_domain',
    targetId: domainId,
    metadata: { domain: row.domain },
    ...(await auditContext()),
  });
  revalidatePath('/admin/domains');
}

/**
 * Remove a custom domain (admin). Disables every link scoped to it
 * (`disabled_by_user`) before deleting the row (FK is SET NULL on delete, so the
 * status flip must happen while domain_id still points at the row). recordAudit.
 */
export async function adminRemoveDomainAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const domainId = String(formData.get('domainId') ?? '');
  if (!domainId) return;

  const [row] = await db
    .select({ domain: customDomains.domain, userId: customDomains.userId })
    .from(customDomains)
    .where(eq(customDomains.id, domainId))
    .limit(1);
  if (!row) return;

  await db
    .update(links)
    .set({ status: 'disabled_by_user' })
    .where(eq(links.domainId, domainId));

  await db.delete(customDomains).where(eq(customDomains.id, domainId));

  await recordAudit(db, {
    actorId: admin.id,
    action: 'domain.remove',
    targetType: 'custom_domain',
    targetId: domainId,
    metadata: { domain: row.domain, userId: row.userId },
    ...(await auditContext()),
  });
  revalidatePath('/admin/domains');
}

// ---- Ad placements (§11) ----------------------------------------------------

/**
 * Shape returned by the create/update ad actions to a `useActionState` client
 * form. `ok` flips on success (the form resets / closes); `error` carries a
 * single human-readable message to render inline.
 */
export interface AdActionState {
  ok?: boolean;
  error?: string;
}

const AD_SLOTS = ['interstitial_top', 'interstitial_bottom', 'tree_top'] as const;

// Accepted creative content-types → file extension for the MinIO key.
const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

// Hard cap on creative size (2 MiB) — these are banners, not hero images.
const MAX_CREATIVE_BYTES = 2 * 1024 * 1024;

const adFieldsSchema = z.object({
  slot: z.enum(AD_SLOTS),
  advertiserName: z.string().trim().min(1, 'Advertiser name is required.').max(120),
  // Only http/https click-throughs (no javascript:/data: etc.).
  clickUrl: z
    .string()
    .trim()
    .url('Enter a valid URL.')
    .refine((u) => /^https?:\/\//i.test(u), 'Click URL must start with http:// or https://'),
  weight: z.coerce.number().int().min(1, 'Weight must be ≥ 1.').max(1000).default(1),
  active: z.boolean().default(true),
  startsAt: z.date().nullable(),
  endsAt: z.date().nullable(),
});

/** Parse an optional datetime-local field; '' / missing → null. */
function parseOptionalDate(raw: FormDataEntryValue | null): Date | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Read the shared ad fields out of a FormData and validate them with zod.
 * Returns either the parsed values or a single error message for the client
 * form. `active` is derived from the checkbox presence ('on' when checked).
 */
function readAdFields(
  formData: FormData,
): { ok: true; values: z.infer<typeof adFieldsSchema> } | { ok: false; error: string } {
  const parsed = adFieldsSchema.safeParse({
    slot: String(formData.get('slot') ?? ''),
    advertiserName: String(formData.get('advertiserName') ?? ''),
    clickUrl: String(formData.get('clickUrl') ?? ''),
    weight: String(formData.get('weight') ?? '1'),
    active: formData.get('active') === 'on' || formData.get('active') === 'true',
    startsAt: parseOptionalDate(formData.get('startsAt')),
    endsAt: parseOptionalDate(formData.get('endsAt')),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? 'Invalid input.' };
  }
  if (parsed.data.startsAt && parsed.data.endsAt && parsed.data.endsAt <= parsed.data.startsAt) {
    return { ok: false, error: 'End time must be after the start time.' };
  }
  return { ok: true, values: parsed.data };
}

/**
 * Upload an uploaded creative to MinIO under `ads/<rand>.<ext>` and return its
 * object key (stored as `imageUrl`). Returns an error string if the file is
 * missing/empty/oversized/unsupported. `required` lets update skip when no new
 * file is chosen (keeping the existing creative).
 */
async function uploadCreative(
  formData: FormData,
  required: boolean,
): Promise<{ ok: true; key: string | null } | { ok: false; error: string }> {
  const file = formData.get('image');
  if (!(file instanceof File) || file.size === 0) {
    if (required) return { ok: false, error: 'Choose a creative image to upload.' };
    return { ok: true, key: null };
  }
  if (file.size > MAX_CREATIVE_BYTES) {
    return { ok: false, error: 'Creative must be 2 MB or smaller.' };
  }
  const ext = IMAGE_EXT[file.type];
  if (!ext) {
    return { ok: false, error: 'Unsupported image type. Use PNG, JPEG, WebP, GIF, or SVG.' };
  }
  const key = `ads/${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await putObject(key, bytes, file.type);
  return { ok: true, key };
}

/**
 * Create an ad placement (§11). requireAdmin + zod-validated fields + a creative
 * upload to MinIO (key stored as `imageUrl`). recordAudit + revalidate.
 * `useActionState` signature: `(prev, formData) => AdActionState`.
 */
export async function createAdPlacementAction(
  _prev: AdActionState,
  formData: FormData,
): Promise<AdActionState> {
  const admin = await requireAdmin();

  const fields = readAdFields(formData);
  if (!fields.ok) return { error: fields.error };

  const creative = await uploadCreative(formData, true);
  if (!creative.ok) return { error: creative.error };
  // `required: true` guarantees a non-null key here.
  const imageUrl = creative.key as string;

  const { slot, advertiserName, clickUrl, weight, active, startsAt, endsAt } = fields.values;

  const [row] = await db
    .insert(adsPlacements)
    .values({ slot, advertiserName, imageUrl, clickUrl, weight, active, startsAt, endsAt })
    .returning({ id: adsPlacements.id });

  await recordAudit(db, {
    actorId: admin.id,
    action: 'ad.create',
    targetType: 'ad_placement',
    targetId: row?.id ?? '',
    metadata: { slot, advertiserName, weight, active },
    ...(await auditContext()),
  });
  revalidatePath('/admin/ads');
  return { ok: true };
}

/**
 * Update an ad placement (§11). All shared fields are replaced; the creative is
 * only swapped when a new file is uploaded (otherwise the existing `imageUrl`
 * key is kept). requireAdmin + zod + recordAudit + revalidate.
 */
export async function updateAdPlacementAction(
  _prev: AdActionState,
  formData: FormData,
): Promise<AdActionState> {
  const admin = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing placement id.' };

  const [existing] = await db
    .select({ id: adsPlacements.id })
    .from(adsPlacements)
    .where(eq(adsPlacements.id, id))
    .limit(1);
  if (!existing) return { error: 'Placement not found.' };

  const fields = readAdFields(formData);
  if (!fields.ok) return { error: fields.error };

  const creative = await uploadCreative(formData, false);
  if (!creative.ok) return { error: creative.error };

  const { slot, advertiserName, clickUrl, weight, active, startsAt, endsAt } = fields.values;

  await db
    .update(adsPlacements)
    .set({
      slot,
      advertiserName,
      clickUrl,
      weight,
      active,
      startsAt,
      endsAt,
      ...(creative.key ? { imageUrl: creative.key } : {}),
    })
    .where(eq(adsPlacements.id, id));

  await recordAudit(db, {
    actorId: admin.id,
    action: 'ad.update',
    targetType: 'ad_placement',
    targetId: id,
    metadata: { slot, advertiserName, weight, active, creativeReplaced: Boolean(creative.key) },
    ...(await auditContext()),
  });
  revalidatePath('/admin/ads');
  return { ok: true };
}

/**
 * Activate / deactivate an ad placement (§11). `active` form field is the
 * desired NEXT state ('true' | 'false'). requireAdmin + recordAudit + revalidate.
 */
export async function toggleAdPlacementAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const active = String(formData.get('active') ?? '') === 'true';

  const [row] = await db
    .select({ advertiserName: adsPlacements.advertiserName })
    .from(adsPlacements)
    .where(eq(adsPlacements.id, id))
    .limit(1);
  if (!row) return;

  await db.update(adsPlacements).set({ active }).where(eq(adsPlacements.id, id));

  await recordAudit(db, {
    actorId: admin.id,
    action: active ? 'ad.activate' : 'ad.deactivate',
    targetType: 'ad_placement',
    targetId: id,
    metadata: { advertiserName: row.advertiserName },
    ...(await auditContext()),
  });
  revalidatePath('/admin/ads');
}

/**
 * Delete an ad placement (§11). The creative object in MinIO is intentionally
 * left in place (cheap, and avoids dangling-reference races); only the row is
 * removed. requireAdmin + recordAudit + revalidate.
 */
export async function deleteAdPlacementAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const [row] = await db
    .select({ advertiserName: adsPlacements.advertiserName, slot: adsPlacements.slot })
    .from(adsPlacements)
    .where(eq(adsPlacements.id, id))
    .limit(1);
  if (!row) return;

  await db.delete(adsPlacements).where(eq(adsPlacements.id, id));

  await recordAudit(db, {
    actorId: admin.id,
    action: 'ad.delete',
    targetType: 'ad_placement',
    targetId: id,
    metadata: { advertiserName: row.advertiserName, slot: row.slot },
    ...(await auditContext()),
  });
  revalidatePath('/admin/ads');
}
