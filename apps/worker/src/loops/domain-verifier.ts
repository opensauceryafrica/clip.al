import { resolveCname, resolveTxt } from 'node:dns/promises';
import { keys, redis } from '@clipal/cache';
import { env } from '@clipal/config';
import { customDomains, db, eq, recordAudit, sql } from '@clipal/db';
import { captureException } from '@clipal/observability';

/**
 * Custom-domain DNS verifier (spec §6 step 5 / §12). Every ~60s, take the set of
 * domains stuck in `pending_dns` and try to confirm ownership:
 *
 *   1. Resolve TXT `_clipal-verify.<domain>` and look for the domain's
 *      `verificationToken`. A match proves the owner controls DNS, so we stamp
 *      `dnsVerifiedAt` and advance to `pending_tls` (Caddy's on-demand TLS then
 *      issues a cert and the activate step flips it to `active`).
 *   2. Best-effort: resolve the apex/sub CNAME and note whether it points at
 *      `DOMAINS_CNAME_TARGET`. This is informational only — TXT is the source of
 *      truth for the pending_dns → pending_tls transition — but a missing/ wrong
 *      CNAME is surfaced in `errorMessage` to help the owner debug.
 *
 * A domain that never verifies is abandoned: after 24h in `pending_dns` we set
 * it to `error` and stop polling it (the status filter below excludes `error`).
 *
 * Single-flight across worker replicas via a short Redis lock — multiple workers
 * resolving DNS in parallel is wasteful and races the status writes. The loop
 * never throws (errors are captured) so a flaky resolver can't kill the worker.
 */

const LOCK_TTL_MS = 55_000;
const BATCH = 200;
const STALE_MS = 24 * 60 * 60 * 1000; // 24h cap on pending_dns polling

interface CaughtDnsError {
  code?: string;
}

/** node:dns rejects with ENODATA/ENOTFOUND for absent records — treat as "no records". */
function dnsErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as CaughtDnsError).code;
  }
  return undefined;
}

/** Resolve TXT for `name`, flattening the string[][] chunks node returns; [] on absence. */
async function txtRecords(name: string): Promise<string[]> {
  try {
    const chunks = await resolveTxt(name);
    // Each record is split into chunks (255-byte segments); join then trim quotes.
    return chunks.map((parts) => parts.join('').trim());
  } catch (err) {
    const code = dnsErrorCode(err);
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'NXDOMAIN') return [];
    throw err;
  }
}

/** Resolve CNAME targets for `name` (lowercased, trailing dot stripped); [] on absence. */
async function cnameTargets(name: string): Promise<string[]> {
  try {
    const targets = await resolveCname(name);
    return targets.map((t) => t.toLowerCase().replace(/\.$/, ''));
  } catch (err) {
    const code = dnsErrorCode(err);
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'NXDOMAIN') return [];
    throw err;
  }
}

/**
 * Verify (or fail) a single pending_dns domain. Returns nothing; all state lives
 * in the row. Per-domain errors are isolated so one bad domain doesn't abort the
 * whole batch.
 */
async function verifyOne(domain: {
  id: string;
  userId: string;
  domain: string;
  verificationToken: string;
  createdAt: Date;
}): Promise<void> {
  const now = new Date();
  const txtName = `_clipal-verify.${domain.domain}`;
  const cnameTarget = env.DOMAINS_CNAME_TARGET.toLowerCase().replace(/\.$/, '');

  try {
    const records = await txtRecords(txtName);
    const matched = records.includes(domain.verificationToken);

    if (matched) {
      // Informational CNAME check — don't block activation on it.
      let cnameNote: string | null = null;
      try {
        const targets = await cnameTargets(domain.domain);
        if (targets.length > 0 && !targets.includes(cnameTarget)) {
          cnameNote = `CNAME points at ${targets.join(', ')} (expected ${cnameTarget})`;
        }
      } catch {
        // Best-effort only; ignore CNAME resolution failures.
      }

      await db
        .update(customDomains)
        .set({
          status: 'pending_tls',
          dnsVerifiedAt: now,
          lastCheckAt: now,
          errorMessage: cnameNote,
        })
        .where(eq(customDomains.id, domain.id));

      await recordAudit(db, {
        actorId: null,
        action: 'domain.dns_verified',
        targetType: 'custom_domain',
        targetId: domain.id,
        metadata: { domain: domain.domain, userId: domain.userId },
      });
      console.log('[domain-verifier] verified', { id: domain.id, domain: domain.domain });
      return;
    }

    // No match yet. If we've blown past the 24h window, give up and stop polling.
    if (now.getTime() - domain.createdAt.getTime() > STALE_MS) {
      await db
        .update(customDomains)
        .set({
          status: 'error',
          lastCheckAt: now,
          errorMessage: `TXT ${txtName} did not contain the verification token within 24h`,
        })
        .where(eq(customDomains.id, domain.id));

      await recordAudit(db, {
        actorId: null,
        action: 'domain.verify_expired',
        targetType: 'custom_domain',
        targetId: domain.id,
        metadata: { domain: domain.domain, userId: domain.userId },
      });
      console.log('[domain-verifier] expired', { id: domain.id, domain: domain.domain });
      return;
    }

    // Still within the window — record the miss and keep polling.
    const found = records.length > 0;
    await db
      .update(customDomains)
      .set({
        lastCheckAt: now,
        errorMessage: found
          ? `TXT ${txtName} present but token not found yet`
          : `TXT ${txtName} not found yet — add it and DNS may take time to propagate`,
      })
      .where(eq(customDomains.id, domain.id));
  } catch (err) {
    // Resolver/DB failure for this one domain — record it and move on.
    captureException(err, { loop: 'domain-verifier', domainId: domain.id });
    await db
      .update(customDomains)
      .set({
        lastCheckAt: now,
        errorMessage: `DNS check failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      .where(eq(customDomains.id, domain.id))
      .catch(() => undefined);
  }
}

export async function runDomainVerifier(): Promise<void> {
  // Single-flight across replicas.
  const acquired = await redis.set(keys.domainVerifyLock, '1', 'PX', LOCK_TTL_MS, 'NX');
  if (acquired !== 'OK') return;

  try {
    const pending = await db
      .select({
        id: customDomains.id,
        userId: customDomains.userId,
        domain: customDomains.domain,
        verificationToken: customDomains.verificationToken,
        createdAt: customDomains.createdAt,
      })
      .from(customDomains)
      .where(eq(customDomains.status, 'pending_dns'))
      // Oldest-checked first. NULLS FIRST so a never-checked (just-added) domain
      // jumps the queue and gets its first probe promptly.
      .orderBy(sql`${customDomains.lastCheckAt} asc nulls first`)
      .limit(BATCH);

    for (const domain of pending) {
      await verifyOne(domain);
    }
  } catch (err) {
    console.error('[domain-verifier] pass error', err);
    captureException(err, { loop: 'domain-verifier' });
  } finally {
    await redis.del(keys.domainVerifyLock).catch(() => undefined);
  }
}
