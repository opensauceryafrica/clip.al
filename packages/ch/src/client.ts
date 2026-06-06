import { env, isProd } from '@clipal/config';
import { createClient, type ClickHouseClient } from '@clickhouse/client';

const globalForCh = globalThis as unknown as { __clipalCh?: ClickHouseClient };

export const ch: ClickHouseClient =
  globalForCh.__clipalCh ??
  createClient({
    url: env.CLICKHOUSE_URL,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    database: env.CLICKHOUSE_DATABASE,
    clickhouse_settings: {
      // Async inserts let the worker fire small batches without blocking on a
      // merge; ClickHouse buffers and flushes them server-side.
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  });

if (!isProd) globalForCh.__clipalCh = ch;

/** Liveness probe for /api/health. */
export async function chPing(): Promise<boolean> {
  try {
    const res = await ch.ping();
    return res.success;
  } catch {
    return false;
  }
}

/** Format a Date as a ClickHouse DateTime64(3) literal (UTC, no 'T'/'Z'). */
export function toChDateTime(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
