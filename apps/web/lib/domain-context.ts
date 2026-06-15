import { redis } from '@clipal/cache';
import { env } from '@clipal/config';
import { lookupActiveDomainId } from './hotpath';

/**
 * Map an incoming request Host to its short-link namespace (§6 custom domains).
 * Returns null for the default namespace (clip.al + any *.clip.al), and the
 * `custom_domains.id` for a verified custom domain so the resolver scopes links
 * by `domain_id`.
 *
 * Latency: the default host (the overwhelming majority of traffic) is decided by
 * a pure string compare with NO datastore I/O. Only an unrecognized host pays a
 * single Redis-cached lookup (60s TTL) against the raw pg pool.
 */
let appHostCache: string | null = null;
function appHost(): string {
  if (appHostCache === null) {
    try {
      appHostCache = new URL(env.APP_URL).host.toLowerCase().split(':')[0] ?? '';
    } catch {
      appHostCache = '';
    }
  }
  return appHostCache;
}

export async function resolveHostDomain(hostHeader: string | null): Promise<string | null> {
  if (!hostHeader) return null;
  const host = (hostHeader.toLowerCase().split(':')[0] ?? '').replace(/\.$/, '');
  if (!host) return null;

  const appH = appHost();
  const cookieDomain = env.COOKIE_DOMAIN.toLowerCase();
  // Default namespace: the app host, the cookie apex, or any of its subdomains.
  if (host === appH || host === cookieDomain || host.endsWith(`.${cookieDomain}`)) return null;

  const ckey = `domain:ctx:${host}`;
  try {
    const cached = await redis.get(ckey);
    if (cached !== null) return cached === 'NONE' ? null : cached;
  } catch {
    // Redis blip → fall through to a direct lookup (still bounded by the route timeout).
  }
  const id = await lookupActiveDomainId(host).catch(() => null);
  redis.set(ckey, id ?? 'NONE', 'EX', 60).catch(() => {});
  return id;
}
