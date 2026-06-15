import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { keys, redis } from '@clipal/cache';
import { getPublicBaseUrl } from '@clipal/config';
import { customDomains, db, eq, recordAudit, users } from '@clipal/db';
import { sendEmail } from '@clipal/email';
import { captureException } from '@clipal/observability';

/**
 * Daily TLS-health probe for active custom domains (spec §6/§12). For each
 * `active` domain we open a short TLS handshake to `<domain>:443`, read the peer
 * certificate, and check it is currently valid and not within the renewal
 * window. A cert that is expired, not-yet-valid, or expiring within
 * `EXPIRY_WARN_DAYS` flips the domain to `error` and emails the owner once so
 * they can intervene (Caddy normally auto-renews; a stuck cert means DNS/ACME is
 * broken and the domain will hard-fail soon).
 *
 * This is intentionally a *minimal* probe: a single handshake with a tight
 * timeout, no HTTP request, no SNI ALPN negotiation, no OCSP. It catches the
 * common failure (cert missing / expired / about to expire) cheaply.
 *
 * TODO(§12): richer health — verify the served cert's SAN actually covers the
 * domain, follow the redirect chain, and re-probe `error` domains so a domain
 * that self-heals (Caddy finally issues) can return to `active` automatically.
 *
 * Single-flight across replicas via a Redis lock; never throws (captured).
 */

const LOCK_TTL_MS = 10 * 60_000; // generous: a daily pass over many domains
const BATCH = 500;
const HANDSHAKE_TIMEOUT_MS = 8_000;
const EXPIRY_WARN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface CertProbe {
  ok: boolean;
  /** Human-readable reason when !ok. */
  reason?: string;
  /** Cert validTo, when a cert was presented. */
  validTo?: Date;
}

/**
 * Open a TLS handshake to host:443 and inspect the presented leaf certificate.
 * Resolves (never rejects) with a CertProbe — connection/timeout failures are
 * reported as `ok: false` with a reason rather than thrown.
 */
function probeCert(host: string): Promise<CertProbe> {
  return new Promise<CertProbe>((resolve) => {
    let settled = false;
    const done = (probe: CertProbe): void => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // already closed
      }
      resolve(probe);
    };

    const socket: TLSSocket = tlsConnect(
      {
        host,
        port: 443,
        servername: host, // SNI — required for cert selection on shared IPs
        timeout: HANDSHAKE_TIMEOUT_MS,
        // We are validating *our own* issued cert's lifetime, not trusting it
        // for a request, so let the handshake complete even if the chain is
        // otherwise unhappy; we read validity off the peer cert directly.
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || Object.keys(cert).length === 0 || !cert.valid_to) {
          done({ ok: false, reason: 'no certificate presented' });
          return;
        }
        const validTo = new Date(cert.valid_to);
        const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
        const now = Date.now();

        if (Number.isNaN(validTo.getTime())) {
          done({ ok: false, reason: `unparseable cert expiry "${cert.valid_to}"` });
          return;
        }
        if (validFrom && !Number.isNaN(validFrom.getTime()) && validFrom.getTime() > now) {
          done({ ok: false, reason: `certificate not yet valid (from ${cert.valid_from})`, validTo });
          return;
        }
        if (validTo.getTime() <= now) {
          done({ ok: false, reason: `certificate expired on ${cert.valid_to}`, validTo });
          return;
        }
        if (validTo.getTime() - now <= EXPIRY_WARN_DAYS * DAY_MS) {
          const days = Math.max(0, Math.round((validTo.getTime() - now) / DAY_MS));
          done({ ok: false, reason: `certificate expires in ${days}d (${cert.valid_to})`, validTo });
          return;
        }
        done({ ok: true, validTo });
      },
    );

    socket.on('error', (err: Error) => done({ ok: false, reason: `TLS handshake failed: ${err.message}` }));
    socket.on('timeout', () => done({ ok: false, reason: `TLS handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms` }));
  });
}

/** Notify the domain owner that their custom domain's TLS is failing. Best-effort. */
async function emailOwner(userId: string, domain: string, reason: string): Promise<void> {
  const [owner] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!owner?.email) return;

  const manageUrl = `${getPublicBaseUrl()}/dashboard/domains`;
  const safeDomain = domain.replace(/[<>]/g, '');
  const safeReason = reason.replace(/[<>]/g, '');
  await sendEmail({
    to: owner.email,
    subject: `Action needed: TLS issue on ${safeDomain}`,
    html: `<p>We detected a TLS certificate problem on your custom domain <strong>${safeDomain}</strong>.</p>
<p>${safeReason}</p>
<p>Links on this domain may stop resolving over HTTPS until it is fixed. Please check the domain's DNS still points at clip.al, then re-verify it from your dashboard.</p>
<p><a href="${manageUrl}">Manage domains</a></p>`,
    text: `TLS issue on ${safeDomain}: ${safeReason}. Links on this domain may stop resolving over HTTPS. Manage: ${manageUrl}`,
  });
}

async function checkOne(domain: {
  id: string;
  userId: string;
  domain: string;
}): Promise<void> {
  const now = new Date();
  try {
    const probe = await probeCert(domain.domain);
    if (probe.ok) {
      // Healthy — stamp the check time and clear any stale error note; leave the
      // status and tlsIssuedAt as-is (Caddy owns issuance).
      await db
        .update(customDomains)
        .set({ lastCheckAt: now, errorMessage: null })
        .where(eq(customDomains.id, domain.id));
      return;
    }

    // Unhealthy — flag the domain and notify the owner once (the status flip from
    // active → error is itself the "once" guard; a domain already in error isn't
    // in this active-only batch).
    const reason = probe.reason ?? 'TLS health check failed';
    await db
      .update(customDomains)
      .set({ status: 'error', lastCheckAt: now, errorMessage: reason })
      .where(eq(customDomains.id, domain.id));

    await recordAudit(db, {
      actorId: null,
      action: 'domain.tls_unhealthy',
      targetType: 'custom_domain',
      targetId: domain.id,
      metadata: { domain: domain.domain, userId: domain.userId, reason },
    });

    await emailOwner(domain.userId, domain.domain, reason).catch((err: unknown) => {
      captureException(err, { loop: 'domain-tls-health', domainId: domain.id, stage: 'email' });
    });

    console.log('[domain-tls-health] flagged', { id: domain.id, domain: domain.domain, reason });
  } catch (err) {
    captureException(err, { loop: 'domain-tls-health', domainId: domain.id });
    await db
      .update(customDomains)
      .set({ lastCheckAt: now })
      .where(eq(customDomains.id, domain.id))
      .catch(() => undefined);
  }
}

export async function runDomainTlsHealth(): Promise<void> {
  const acquired = await redis.set(keys.domainTlsHealthLock, '1', 'PX', LOCK_TTL_MS, 'NX');
  if (acquired !== 'OK') return;

  try {
    const active = await db
      .select({
        id: customDomains.id,
        userId: customDomains.userId,
        domain: customDomains.domain,
      })
      .from(customDomains)
      .where(eq(customDomains.status, 'active'))
      .orderBy(customDomains.lastCheckAt)
      .limit(BATCH);

    for (const domain of active) {
      await checkOne(domain);
    }
  } catch (err) {
    console.error('[domain-tls-health] pass error', err);
    captureException(err, { loop: 'domain-tls-health' });
  } finally {
    await redis.del(keys.domainTlsHealthLock).catch(() => undefined);
  }
}
