import { env } from '@clipal/config';
import { redisPing } from '@clipal/cache';
import { chPing } from '@clipal/ch';
import { sqlClient } from '@clipal/db';

/**
 * Operator-facing health endpoint. Probes each backing service and returns 200
 * when all are up, 503 when any is down. Not used for the container healthcheck
 * (see /api/ping) precisely because it can legitimately report 503.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ServiceStatus = { status: 'up' | 'down'; latencyMs: number; error?: string };

async function probe(fn: () => Promise<boolean>, timeoutMs = 2000): Promise<ServiceStatus> {
  const started = Date.now();
  try {
    const ok = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs),
      ),
    ]);
    return { status: ok ? 'up' : 'down', latencyMs: Date.now() - started };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'error',
    };
  }
}

async function checkPostgres(): Promise<boolean> {
  const rows = await sqlClient<{ ok: number }[]>`select 1 as ok`;
  return rows[0]?.ok === 1;
}

async function checkMinio(): Promise<boolean> {
  const res = await fetch(`${env.S3_ENDPOINT}/minio/health/live`, { cache: 'no-store' });
  return res.ok;
}

export async function GET(): Promise<Response> {
  const [postgres, redis, clickhouse, minio] = await Promise.all([
    probe(checkPostgres),
    probe(redisPing),
    probe(chPing),
    probe(checkMinio),
  ]);

  const services = { postgres, redis, clickhouse, minio };
  const allUp = Object.values(services).every((s) => s.status === 'up');

  return Response.json(
    {
      status: allUp ? 'ok' : 'degraded',
      version: process.env['npm_package_version'] ?? '0.1.0',
      time: new Date().toISOString(),
      services,
    },
    {
      status: allUp ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
