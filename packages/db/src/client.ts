import { env, isProd } from '@clipal/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * General-purpose Drizzle client for app + worker code.
 *
 * The redirect hot path does NOT use this — it opens its own minimal raw
 * postgres pool and runs a parameterized query, to avoid pulling the ORM and
 * full schema into that latency-critical route (§9).
 *
 * A globalThis cache prevents connection exhaustion across Next.js dev hot
 * reloads (each reload re-evaluates the module).
 */
const globalForDb = globalThis as unknown as {
  __clipalPg?: ReturnType<typeof postgres>;
};

const queryClient =
  globalForDb.__clipalPg ??
  postgres(env.DATABASE_URL, {
    max: 10,
    // Keep idle connections modest on a shared VPS.
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (!isProd) globalForDb.__clipalPg = queryClient;

export const db = drizzle(queryClient, { schema });
export { schema };
export type DB = typeof db;

/** The underlying postgres.js client, for the rare raw-SQL need. */
export const sqlClient = queryClient;
