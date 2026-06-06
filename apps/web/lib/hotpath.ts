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
}

/** Single indexed lookup by unique code. Returns the row or null. */
export async function lookupLink(code: string): Promise<LinkRow | null> {
  const rows = await hotPg<LinkRow[]>`
    SELECT id, destination_url, owner_id, status, safety_state, interstitial_required
    FROM links
    WHERE code = ${code}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
