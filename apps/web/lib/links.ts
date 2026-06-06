import { keys, redis } from '@clipal/cache';
import { lookupLink } from './hotpath';

export interface ResolvedLink {
  id: string;
  url: string;
  ownerId: string | null;
  status: string;
  safetyState: string;
  interstitial: boolean;
}

/**
 * Resolve a link for the interstitial (`/p`) and its continue route, using the
 * same Redis hot cache as `/r` and falling back to Postgres. Returns null for
 * unknown or cache-disabled links.
 */
export async function resolveLink(code: string): Promise<ResolvedLink | null> {
  const cached = await redis.get(keys.hotLink(code)).catch(() => null);
  if (cached === 'DISABLED') return null;
  if (cached) {
    try {
      const c = JSON.parse(cached) as {
        url: string;
        interstitial: boolean;
        safety: string;
        id: string;
        owner: string | null;
      };
      return {
        id: c.id,
        url: c.url,
        ownerId: c.owner,
        status: 'active',
        safetyState: c.safety,
        interstitial: c.interstitial,
      };
    } catch {
      // fall through to DB
    }
  }

  const row = await lookupLink(code);
  if (!row) return null;
  return {
    id: row.id,
    url: row.destination_url,
    ownerId: row.owner_id,
    status: row.status,
    safetyState: row.safety_state,
    interstitial: row.interstitial_required,
  };
}
