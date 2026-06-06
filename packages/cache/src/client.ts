import { env, isProd } from '@clipal/config';
import { Redis, type RedisOptions } from 'ioredis';

/**
 * Shared Redis connection for KV, rate limits, the hot-link cache, and
 * (non-blocking) XADD. Reused process-wide. A globalThis guard prevents new
 * connections on every Next.js dev hot reload.
 *
 * Blocking commands (XREADGROUP BLOCK in the worker) must NOT share this
 * connection — use `createRedis()` for a dedicated one.
 */
const sharedOptions: RedisOptions = {
  // Fail commands reasonably fast so the redirect path can fall back to
  // Postgres instead of hanging when Redis is unreachable (§10 failure mode).
  maxRetriesPerRequest: 3,
  connectTimeout: 1000,
  enableReadyCheck: true,
  retryStrategy: (times: number) => Math.min(times * 200, 2000),
};

// ioredis is an EventEmitter; an 'error' event with no listener crashes the
// process. Always attach one so a transient Redis blip degrades gracefully
// instead of taking the whole server down. Logging is throttled to avoid spam.
let lastErrorLog = 0;
function attachErrorHandler(client: Redis, label: string): Redis {
  client.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastErrorLog > 5000) {
      lastErrorLog = now;
      console.warn(`[redis:${label}] ${err.message}`);
    }
  });
  return client;
}

const globalForRedis = globalThis as unknown as { __clipalRedis?: Redis };

export const redis: Redis =
  globalForRedis.__clipalRedis ?? attachErrorHandler(new Redis(env.REDIS_URL, sharedOptions), 'shared');

if (!isProd) globalForRedis.__clipalRedis = redis;

/** Create an additional connection (e.g. for blocking stream reads in the worker). */
export function createRedis(options: RedisOptions = {}): Redis {
  return attachErrorHandler(new Redis(env.REDIS_URL, { ...sharedOptions, ...options }), 'aux');
}

/** Liveness probe for /api/health. */
export async function redisPing(): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}
