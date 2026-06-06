import net from 'node:net';

/**
 * Returns true if a destination hostname must be rejected at submission (§14.1):
 * any IP literal (v4 or v6 — public or private), localhost, link-local, `.local`
 * and other internal TLDs, and single-label "internal-looking" names.
 *
 * We reject ALL IP literals (not just private ranges) because a public shortener
 * should point at named destinations, and raw-IP targets are a common abuse and
 * SSRF-adjacent vector. Note: we do NOT resolve DNS at submission (that would be
 * an SSRF vector itself); DNS-rebinding to a private IP post-creation is a known
 * residual risk handled by the rolling re-scan + report flow, not here.
 */
const INTERNAL_TLD = /\.(local|internal|lan|home|corp|intranet|test|localhost)$/;

export function isUnsafeHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, ''); // drop FQDN trailing dot
  const bare = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;

  // Any IP literal (the URL parser also accepts IPv4 in the host position).
  if (net.isIP(bare) !== 0) return true;

  if (h === 'localhost') return true;
  if (INTERNAL_TLD.test(h)) return true;

  // No dot → not a public FQDN (e.g. "intranet", "router"). Internal-looking.
  if (!h.includes('.')) return true;

  return false;
}
