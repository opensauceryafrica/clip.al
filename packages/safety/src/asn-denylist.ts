/**
 * Datacenter / cloud-provider IP denylist for ad bot-defense (spec §14.7).
 *
 * Ads must never render for traffic that originates from a hosting provider's
 * network — that traffic is overwhelmingly bots, scrapers, headless renderers
 * and click-fraud farms, and serving (let alone counting) impressions/clicks to
 * it both wastes inventory and risks an AdSense policy strike. We approximate
 * "is this a datacenter?" with a curated list of well-known cloud/hosting CIDR
 * ranges rather than a live ASN lookup (no network dependency on the hot path).
 *
 * This is intentionally a *representative subset*, not an exhaustive map of
 * every provider allocation. It catches the loudest offenders cheaply. The real
 * defense is layered (UA list, Sec-Fetch headers, Accept-Language, consent) — a
 * datacenter miss here just means we fall through to those other gates.
 *
 * TODO(@owner): expand from an authoritative source (e.g. the published AWS
 * `ip-ranges.json`, GCP `cloud.json`, Azure ServiceTags, and the providers'
 * BGP allocations) and consider refreshing it from a build-time job or a small
 * runtime ASN service. Keep the matcher (isDatacenterIp) untouched when you do.
 */

type Cidr4 = { base: number; mask: number };
type Cidr6 = { hi: bigint; lo: bigint; bits: number };

/**
 * Curated IPv4 CIDR ranges, grouped by provider. These are real, currently
 * advertised allocations for each cloud — a small but high-signal sample.
 */
const RAW_V4: readonly string[] = [
  // --- Amazon Web Services (EC2 / Lambda / NAT egress) ---
  '3.0.0.0/9',
  '13.32.0.0/15',
  '15.177.0.0/18',
  '18.32.0.0/11',
  '34.192.0.0/10',
  '35.152.0.0/13',
  '52.0.0.0/11',
  '54.144.0.0/12',
  '99.77.128.0/17',

  // --- Google Cloud Platform / Google ---
  '34.0.0.0/9', // overlaps GCP customer ranges (34.64.0.0/10 etc.)
  '35.184.0.0/13',
  '35.192.0.0/14',
  '35.196.0.0/15',
  '104.154.0.0/15',
  '104.196.0.0/14',
  '130.211.0.0/16',
  '146.148.0.0/17',

  // --- Microsoft Azure ---
  '13.64.0.0/11',
  '20.0.0.0/8', // large Azure allocation
  '40.64.0.0/10',
  '52.224.0.0/11',
  '104.40.0.0/13',
  '137.116.0.0/15',
  '168.61.0.0/16',

  // --- DigitalOcean ---
  '104.131.0.0/16',
  '107.170.0.0/16',
  '134.209.0.0/16',
  '138.197.0.0/16',
  '143.198.0.0/16',
  '157.230.0.0/16',
  '159.65.0.0/16',
  '159.89.0.0/16',
  '165.227.0.0/16',
  '167.71.0.0/16',
  '167.99.0.0/16',
  '174.138.0.0/16',
  '178.62.0.0/16',
  '188.166.0.0/16',
  '206.189.0.0/16',

  // --- Hetzner Online ---
  '5.9.0.0/16',
  '78.46.0.0/15',
  '88.198.0.0/16',
  '94.130.0.0/16',
  '116.202.0.0/15',
  '116.203.0.0/16',
  '136.243.0.0/16',
  '138.201.0.0/16',
  '142.132.0.0/16',
  '144.76.0.0/16',
  '148.251.0.0/16',
  '159.69.0.0/16',
  '176.9.0.0/16',
  '178.63.0.0/16',
  '188.40.0.0/16',
  '195.201.0.0/16',

  // --- OVHcloud ---
  '51.38.0.0/16',
  '51.68.0.0/16',
  '51.75.0.0/16',
  '51.83.0.0/16',
  '51.89.0.0/16',
  '51.91.0.0/16',
  '54.36.0.0/16',
  '91.121.0.0/16',
  '92.222.0.0/16',
  '137.74.0.0/16',
  '141.94.0.0/16',
  '145.239.0.0/16',
  '146.59.0.0/16',
  '147.135.0.0/16',
  '149.202.0.0/16',
  '151.80.0.0/16',
  '167.114.0.0/16',
  '178.32.0.0/15',
  '188.165.0.0/16',
  '213.186.32.0/19',
];

/**
 * A couple of IPv6 ranges so the matcher has v6 coverage (AWS + GCP + Hetzner).
 * v6 is matched on the high/low 64-bit halves; only prefixes up to /64 here.
 */
const RAW_V6: readonly string[] = [
  '2600:1f00::/24', // AWS
  '2a05:d000::/29', // AWS (eu)
  '2600:1900::/28', // Google Cloud
  '2a01:4f8::/29', // Hetzner
  '2a01:4f9::/32', // Hetzner (cloud)
];

function parseV4(cidr: string): Cidr4 | null {
  const slash = cidr.indexOf('/');
  if (slash < 0) return null;
  const addr = cidr.slice(0, slash);
  const prefix = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const n = ipv4ToInt(addr);
  if (n === null) return null;
  // Mask as an unsigned 32-bit value (prefix 0 → 0).
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (n & mask) >>> 0, mask };
}

function ipv4ToInt(addr: string): number | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const oct = Number(part);
    if (oct > 255) return null;
    n = (n << 8) | oct;
  }
  return n >>> 0;
}

function parseV6(cidr: string): Cidr6 | null {
  const slash = cidr.indexOf('/');
  if (slash < 0) return null;
  const bits = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(bits) || bits < 0 || bits > 128) return null;
  const full = ipv6ToBigint(cidr.slice(0, slash));
  if (full === null) return null;
  return splitWithMask(full, bits);
}

/** Expand an IPv6 address (supporting `::`) to a 128-bit bigint. Never throws. */
function ipv6ToBigint(addr: string): bigint | null {
  let a = addr.trim().toLowerCase();
  if (a.length === 0) return null;
  // Strip a zone id if present (fe80::1%eth0).
  const pct = a.indexOf('%');
  if (pct >= 0) a = a.slice(0, pct);
  const dbl = a.indexOf('::');
  let head: string[];
  let tail: string[];
  if (dbl >= 0) {
    if (a.indexOf('::', dbl + 1) >= 0) return null; // only one `::` allowed
    head = a.slice(0, dbl) === '' ? [] : a.slice(0, dbl).split(':');
    tail = a.slice(dbl + 2) === '' ? [] : a.slice(dbl + 2).split(':');
  } else {
    head = a.split(':');
    tail = [];
  }
  const groups = [...head];
  const missing = 8 - (head.length + tail.length);
  if (dbl < 0) {
    if (head.length !== 8) return null;
  } else {
    if (missing < 0) return null;
    for (let i = 0; i < missing; i++) groups.push('0');
    groups.push(...tail);
  }
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const g of groups) {
    if (g === '') return null;
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    result = (result << 16n) | BigInt(parseInt(g, 16));
  }
  return result;
}

function splitWithMask(full: bigint, bits: number): Cidr6 {
  const maskAll = (1n << 128n) - 1n;
  const mask = bits === 0 ? 0n : (maskAll << BigInt(128 - bits)) & maskAll;
  const masked = full & mask;
  return {
    hi: masked >> 64n,
    lo: masked & ((1n << 64n) - 1n),
    bits,
  };
}

// Pre-parsed at module load. Anything that fails to parse is silently dropped so
// a typo in the list above can never break the matcher (which must never throw).
const V4: readonly Cidr4[] = RAW_V4.map(parseV4).filter((c): c is Cidr4 => c !== null);
const V6: readonly Cidr6[] = RAW_V6.map(parseV6).filter((c): c is Cidr6 => c !== null);

/**
 * True when `ip` falls inside any known datacenter/cloud CIDR range.
 *
 * Accepts a plain v4 ("203.0.113.7"), a v6 ("2600:1f00::1"), or a v4-mapped v6
 * ("::ffff:203.0.113.7"). Garbage / empty / unparseable input returns `false`
 * (fail-open: an undetectable IP is treated as residential, not blocked). This
 * function NEVER throws.
 */
export function isDatacenterIp(ip: string): boolean {
  try {
    if (!ip) return false;
    const s = ip.trim();
    if (s === '' || s === '0.0.0.0' || s === '::') return false;

    // v4-mapped v6 (::ffff:a.b.c.d) → test as v4.
    const mapped = s.toLowerCase().startsWith('::ffff:') ? s.slice('::ffff:'.length) : '';
    const v4Candidate = mapped !== '' && mapped.includes('.') ? mapped : s;

    if (v4Candidate.includes('.') && !v4Candidate.includes(':')) {
      const n = ipv4ToInt(v4Candidate);
      if (n === null) return false;
      for (const { base, mask } of V4) {
        if (((n & mask) >>> 0) === base) return true;
      }
      return false;
    }

    if (s.includes(':')) {
      const full = ipv6ToBigint(s);
      if (full === null) return false;
      for (const c of V6) {
        const { hi, lo } = splitWithMask(full, c.bits);
        if (hi === c.hi && lo === c.lo) return true;
      }
      return false;
    }

    return false;
  } catch {
    return false;
  }
}
