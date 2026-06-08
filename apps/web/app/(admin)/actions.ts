'use server';

import { invalidateUserCache, revokeAllSessions } from '@clipal/auth';
import {
  addBlockedDomain,
  addBrandTerm,
  keys,
  redis,
  removeBlockedDomain,
  removeBrandTerm,
} from '@clipal/cache';
import { getPublicBaseUrl } from '@clipal/config';
import {
  blockedDomains,
  db,
  eq,
  flaggedBrandTerms,
  linkReports,
  links,
  recordAudit,
  users,
} from '@clipal/db';
import { sendAccountSuspended } from '@clipal/email';
import { registrableDomain } from '@clipal/safety';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
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

// ---- Blocklist --------------------------------------------------------------

export async function adminBlockDomainAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const reason = String(formData.get('reason') ?? '').trim() || 'manual';
  const domain = registrableDomain(String(formData.get('domain') ?? ''));
  if (!domain) return;

  await db
    .insert(blockedDomains)
    .values({ domain, reason, addedBy: admin.id })
    .onConflictDoNothing({ target: blockedDomains.domain });
  await addBlockedDomain(domain);
  await recordAudit(db, {
    actorId: admin.id,
    action: 'domain.block',
    targetType: 'domain',
    targetId: domain,
    metadata: { reason },
    ...(await auditContext()),
  });
  revalidatePath('/admin/blocklist');
}

export async function adminUnblockDomainAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const domain = String(formData.get('domain') ?? '').trim().toLowerCase();
  if (!domain) return;

  await db.delete(blockedDomains).where(eq(blockedDomains.domain, domain));
  await removeBlockedDomain(domain);
  await recordAudit(db, {
    actorId: admin.id,
    action: 'domain.unblock',
    targetType: 'domain',
    targetId: domain,
    ...(await auditContext()),
  });
  revalidatePath('/admin/blocklist');
}

// ---- Brand terms ------------------------------------------------------------

export async function adminAddBrandTermAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  // Lowercase, strip whitespace; the check is a substring of the hostname.
  const term = String(formData.get('term') ?? '')
    .trim()
    .toLowerCase();
  if (!term) return;
  const policy = String(formData.get('policy') ?? 'flag') === 'reject' ? 'reject' : 'flag';

  await db
    .insert(flaggedBrandTerms)
    .values({ term, policy, addedBy: admin.id })
    .onConflictDoUpdate({ target: flaggedBrandTerms.term, set: { policy, addedBy: admin.id } });
  await addBrandTerm(term, policy);
  await recordAudit(db, {
    actorId: admin.id,
    action: 'brand_term.add',
    targetType: 'brand_term',
    targetId: term,
    metadata: { policy },
    ...(await auditContext()),
  });
  revalidatePath('/admin/brand-terms');
}

export async function adminRemoveBrandTermAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const term = String(formData.get('term') ?? '')
    .trim()
    .toLowerCase();
  if (!term) return;

  await db.delete(flaggedBrandTerms).where(eq(flaggedBrandTerms.term, term));
  await removeBrandTerm(term);
  await recordAudit(db, {
    actorId: admin.id,
    action: 'brand_term.remove',
    targetType: 'brand_term',
    targetId: term,
    ...(await auditContext()),
  });
  revalidatePath('/admin/brand-terms');
}
