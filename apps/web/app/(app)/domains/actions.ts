'use server';

import { planLimits, resolvePlan } from '@clipal/billing';
import { env } from '@clipal/config';
import {
  and,
  count,
  customDomains,
  db,
  eq,
  links,
  recordAudit,
} from '@clipal/db';
import { checkBlocklist, isUnsafeHost, registrableDomain } from '@clipal/safety';
import { randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { FormActionState } from '@/lib/action-state';
import { requireUser } from '@/lib/auth';
import { getClientIp, getUserAgent } from '@/lib/request';

const DOMAIN_MAX = 253;

async function auditContext(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  return { ip: getClientIp(h), userAgent: getUserAgent(h) };
}

/**
 * The clip.al apex (and its subdomains) may never be registered as a "custom"
 * domain — they're already served by the wildcard Caddy site, and letting a user
 * claim e.g. `evil.clip.al` would hijack platform routing. We compare against the
 * cookie/base domain (`clip.al` in prod, `localhost` in dev) which is the
 * platform's own registrable host.
 */
function isPlatformHost(host: string): boolean {
  const base = env.COOKIE_DOMAIN.replace(/^\./, '').toLowerCase();
  if (!base) return false;
  return host === base || host.endsWith(`.${base}`);
}

/**
 * Normalize raw user input into a bare, lowercased custom-domain host, or return
 * a human error. A custom domain must be a real public FQDN: it must parse to a
 * registrable domain, must not be an IP/localhost/internal host, must not be the
 * clip.al apex or a subdomain of it, and must not be on the safety blocklist.
 */
async function normalizeDomain(
  raw: string,
): Promise<{ host: string } | { error: string }> {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return { error: 'Enter a domain.' };
  if (trimmed.length > DOMAIN_MAX) {
    return { error: `Domain must be ${DOMAIN_MAX} characters or fewer.` };
  }

  // Accept "go.brand.com", "https://go.brand.com/path", etc. — extract the host.
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return { error: 'Enter a valid domain.' };
  }
  if (!host) return { error: 'Enter a valid domain.' };

  // Must resolve to a registrable (eTLD+1) domain — rejects garbage / bare TLDs.
  const registrable = registrableDomain(host);
  if (!registrable) return { error: 'That is not a valid public domain.' };

  // Reject IP literals, localhost, private/internal hosts (SSRF-adjacent).
  if (isUnsafeHost(host)) {
    return { error: 'That host is not allowed.' };
  }

  // Never let a user claim clip.al or any of its subdomains.
  if (isPlatformHost(host)) {
    return { error: 'You cannot add a clip.al domain.' };
  }

  // Safety blocklist (exact eTLD+1 reject, or keyword reject).
  const sld = registrable.split('.')[0] ?? registrable;
  const decision = await checkBlocklist(host, registrable, sld).catch(() => ({
    action: 'allow' as const,
  }));
  if (decision.action === 'reject') {
    return { error: 'That domain is blocked.' };
  }

  return { host };
}

/**
 * Add a custom domain for the current user. Plan-gated on
 * `planLimits(plan).customDomains` (free = 0 → plan_required) and capped at that
 * count. Validates + normalizes the host, generates a verification token, and
 * inserts a `pending_dns` row. The user then publishes the CNAME + TXT records;
 * the worker promotes the status (pending_dns → pending_tls → active / error).
 * requireUser + recordAudit + revalidate.
 */
export async function addDomainAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();

  const plan = await resolvePlan(user.id);
  const cap = planLimits(plan).customDomains;
  if (cap <= 0) {
    return {
      error: 'Custom domains are available on the Pro and Business plans.',
    };
  }

  const result = await normalizeDomain(String(formData.get('domain') ?? ''));
  if ('error' in result) return { error: result.error };
  const { host } = result;

  // Enforce the per-plan cap (count the user's existing, non-removed domains).
  const [{ value: used } = { value: 0 }] = await db
    .select({ value: count() })
    .from(customDomains)
    .where(eq(customDomains.userId, user.id));
  if (used >= cap) {
    return {
      error: `Your plan allows ${cap} custom domain${cap === 1 ? '' : 's'}.`,
    };
  }

  // Global uniqueness — `domain` is unique across the platform.
  const [existing] = await db
    .select({ id: customDomains.id, userId: customDomains.userId })
    .from(customDomains)
    .where(eq(customDomains.domain, host))
    .limit(1);
  if (existing) {
    return { error: 'That domain is already registered.' };
  }

  const verificationToken = randomBytes(16).toString('hex');

  let domainId: string;
  try {
    const [row] = await db
      .insert(customDomains)
      .values({ userId: user.id, domain: host, verificationToken, status: 'pending_dns' })
      .returning({ id: customDomains.id });
    if (!row) return { error: 'Could not add domain. Try again.' };
    domainId = row.id;
  } catch {
    // Unique-violation race (two adds of the same host) lands here.
    return { error: 'That domain is already registered.' };
  }

  await recordAudit(db, {
    actorId: user.id,
    action: 'domain.add',
    targetType: 'custom_domain',
    targetId: domainId,
    metadata: { domain: host },
    ...(await auditContext()),
  });

  revalidatePath('/domains');
  return { ok: true };
}

/**
 * Force a re-check of a pending/error domain soon: clear `lastCheckAt` so the
 * worker's next sweep picks it up immediately (rather than waiting out the
 * normal re-check interval). Owner-scoped. No-op on already-active domains.
 */
export async function verifyDomainAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const domainId = String(formData.get('domainId') ?? '');
  if (!domainId) return;

  const [row] = await db
    .select({ id: customDomains.id, domain: customDomains.domain })
    .from(customDomains)
    .where(and(eq(customDomains.id, domainId), eq(customDomains.userId, user.id)))
    .limit(1);
  if (!row) return;

  // Nudge the worker: a null lastCheckAt sorts first in the re-check sweep.
  await db
    .update(customDomains)
    .set({ lastCheckAt: null })
    .where(eq(customDomains.id, domainId));

  await recordAudit(db, {
    actorId: user.id,
    action: 'domain.recheck',
    targetType: 'custom_domain',
    targetId: domainId,
    metadata: { domain: row.domain },
    ...(await auditContext()),
  });

  revalidatePath('/domains');
}

/**
 * Remove a custom domain (owner action). Soft-removes by deleting the row AND
 * disabling every link the user had scoped to that domain (status
 * `disabled_by_user`) so those short URLs stop resolving once the DNS is
 * repointed. The links' `domain_id` FK is `ON DELETE SET NULL`, so disabling
 * before/with the delete keeps them off. requireUser + recordAudit + revalidate.
 */
export async function removeDomainAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const domainId = String(formData.get('domainId') ?? '');
  if (!domainId) return;

  const [row] = await db
    .select({ id: customDomains.id, domain: customDomains.domain })
    .from(customDomains)
    .where(and(eq(customDomains.id, domainId), eq(customDomains.userId, user.id)))
    .limit(1);
  if (!row) return;

  // Disable the user's links under this domain first (FK is SET NULL on delete,
  // so we must flip status while domain_id still points at the row).
  await db
    .update(links)
    .set({ status: 'disabled_by_user' })
    .where(and(eq(links.ownerId, user.id), eq(links.domainId, domainId)));

  await db.delete(customDomains).where(eq(customDomains.id, domainId));

  await recordAudit(db, {
    actorId: user.id,
    action: 'domain.remove',
    targetType: 'custom_domain',
    targetId: domainId,
    metadata: { domain: row.domain },
    ...(await auditContext()),
  });

  revalidatePath('/domains');
}
