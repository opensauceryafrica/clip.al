import { env, isProd } from '@clipal/config';
import postgres from 'postgres';

/**
 * Dedicated, minimal Postgres pool for the redirect hot path (§9).
 *
 * Deliberately NOT the Drizzle ORM / @clipal/db client — this route must stay
 * lean and never pull the full schema into the latency-critical path. One small
 * pool opened at module load and reused forever. The single query it runs is a
 * parameterized tagged-template (postgres.js binds params; no interpolation).
 */
const globalForHot = globalThis as unknown as { __clipalHotPg?: ReturnType<typeof postgres> };

const hotPg =
  globalForHot.__clipalHotPg ??
  postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 5,
    // The hot query is the same shape every time — prepared statements help.
    prepare: true,
  });

if (!isProd) globalForHot.__clipalHotPg = hotPg;

export interface LinkRow {
  id: string;
  destination_url: string;
  owner_id: string | null;
  status: string;
  safety_state: string;
  interstitial_required: boolean;
  // Phase 2 power-link fields (all O(1) to evaluate on the hot path).
  expires_at: Date | null;
  max_clicks: number | null;
  routing_mode: string;
  has_password: boolean;
  domain_id: string | null;
  clicks_total: string; // postgres.js returns int8 as a string; coerced by the caller
}

// Selected on the hot path. `has_password` avoids ever shipping the hash to cache.
const LINK_COLS = `
  id, destination_url, owner_id, status, safety_state, interstitial_required,
  expires_at, max_clicks, routing_mode, (password_hash IS NOT NULL) AS has_password,
  domain_id, coalesce(clicks_total, 0)::text AS clicks_total
`;

/**
 * Resolve a code to its link. Tries the current code first; on a miss, resolves
 * an old back-half via the GIN-indexed `previous_codes` array so renamed links
 * keep redirecting. The common path is the single exact query; the alias query
 * only runs on an exact miss (rare, and itself behind the Redis cache).
 *
 * TODO(phase2-ws4): when custom domains land, scope the exact lookup by
 * `domain_id` (codes are unique PER DOMAIN — see the links_domain_code_key index).
 */
export async function lookupLink(code: string): Promise<LinkRow | null> {
  const exact = await hotPg<LinkRow[]>`
    SELECT ${hotPg.unsafe(LINK_COLS)}
    FROM links
    WHERE code = ${code}
    LIMIT 1
  `;
  if (exact[0]) return exact[0];

  const alias = await hotPg<LinkRow[]>`
    SELECT ${hotPg.unsafe(LINK_COLS)}
    FROM links
    WHERE previous_codes @> ${[code]}
    LIMIT 1
  `;
  return alias[0] ?? null;
}

export interface DestinationRow {
  /** Rule selector — shape matches @clipal/db DestinationMatch (geo|device|ab). */
  match: unknown;
  destination_url: string;
  order: number;
}

/**
 * Fetch a power link's routing rules, ordered. Only called on a cache MISS for a
 * link whose `routing_mode != 'single'` — the result is then baked into the Redis
 * payload so warm redirects never touch this query.
 */
export async function lookupDestinations(linkId: string): Promise<DestinationRow[]> {
  return hotPg<DestinationRow[]>`
    SELECT match, destination_url, "order"
    FROM link_destinations
    WHERE link_id = ${linkId}
    ORDER BY "order" ASC
  `;
}
