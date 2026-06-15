import { env } from '@clipal/config';
import { customDomains, db, eq } from '@clipal/db';
import { captureException } from '@clipal/observability';
import { headers } from 'next/headers';
import { getClientIp } from '@/lib/request';

/**
 * Caddy on-demand-TLS gate (spec §6 step 6 / §14.3).
 *
 * Caddy calls this endpoint (`on_demand_tls { ask ... }`) before issuing a
 * certificate for an arbitrary SNI host. We return 200 ONLY when that host is a
 * known custom domain that has cleared DNS verification (status `pending_tls` or
 * `active`) — anything else 404s, so an attacker can't make us mint certs (and
 * exhaust ACME rate limits) for hosts we don't serve.
 *
 * This endpoint is INTERNAL: it must never be reachable from the public internet
 * via Caddy. We enforce that two ways:
 *   1. IP allow-list — the request's real client IP must equal
 *      `CADDY_CHECK_ALLOWED_IP` (set this to Caddy's address on the Docker
 *      network in production), OR
 *   2. the request must originate from a private/loopback address. Inside the
 *      compose network Caddy reaches `web:3000` directly (no Caddy in front of
 *      this internal hop), so the peer IP is a private Docker-network address
 *      (172.16/12, 10/8, 192.168/16) or loopback. Public clients can only reach
 *      us THROUGH Caddy, which never proxies `/internal/*`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ELIGIBLE = ['pending_tls', 'active'] as const;

/** True for RFC-1918 / loopback / link-local addresses (the Docker network). */
function isPrivateAddress(ip: string): boolean {
  if (!ip || ip === '0.0.0.0') return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('::ffff:')) return isPrivateAddress(ip.slice('::ffff:'.length));
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  const low = ip.toLowerCase();
  if (low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe8')) return true;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const [a, b] = parts.map((p) => Number.parseInt(p, 10));
  if (a === undefined || b === undefined) return false;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (Docker default)
  return false;
}

function isAllowed(ip: string): boolean {
  const allow = env.CADDY_CHECK_ALLOWED_IP.trim();
  if (allow && ip === allow) return true;
  return isPrivateAddress(ip);
}

export async function GET(request: Request): Promise<Response> {
  const h = await headers();
  const clientIp = getClientIp(h);

  if (!isAllowed(clientIp)) {
    // Not Caddy / not the internal network — pretend we don't exist.
    return new Response('Not found', { status: 404 });
  }

  const domain = new URL(request.url).searchParams.get('domain')?.trim().toLowerCase();
  if (!domain) {
    return new Response('Bad request', { status: 400 });
  }

  try {
    const [row] = await db
      .select({ status: customDomains.status })
      .from(customDomains)
      .where(eq(customDomains.domain, domain))
      .limit(1);

    if (row && (ELIGIBLE as readonly string[]).includes(row.status)) {
      return new Response('OK', { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  } catch (err) {
    // Fail CLOSED: if we can't confirm the domain, do NOT authorize cert
    // issuance. A 404 makes Caddy skip on-demand TLS for this host.
    captureException(err, { route: 'caddy_check', domain });
    return new Response('Not found', { status: 404 });
  }
}
