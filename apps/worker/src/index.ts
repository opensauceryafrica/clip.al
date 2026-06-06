import { startHealthServer } from './health';
import { initGeo } from './lib/geo';
import { getDailySalt } from './lib/salt';
import { runClickIngest } from './loops/click-ingest';
import { reapAuthCodes, reapSessions } from './loops/reapers';
import { runRescan } from './loops/rescan';
import { every } from './scheduler';

const MINUTE = 60_000;

/**
 * The clip.al worker. One process, several async loops (§18). Each can later be
 * split into its own container without app changes — the boundaries here are
 * already clean (a long-running stream consumer + a handful of scheduled jobs).
 */
async function main(): Promise<void> {
  console.log('[worker] starting');
  startHealthServer(Number(process.env['WORKER_HEALTH_PORT'] ?? 9090));
  await initGeo();

  const controller = new AbortController();

  // Scheduled jobs.
  every('rescan', MINUTE, runRescan); // §18.2 rolling URL re-scan
  every('salt-rotate', 60 * MINUTE, async () => {
    await getDailySalt(); // §18.4 keep the current UTC-day IP salt warm
  });
  every('reap-auth-codes', 5 * MINUTE, reapAuthCodes); // §18.5
  every('reap-sessions', 24 * 60 * MINUTE, reapSessions); // §18.6

  // Long-running click ingest (§18.1).
  const ingest = runClickIngest(controller.signal);

  const shutdown = (signal: string): void => {
    console.log(`[worker] ${signal} — shutting down`);
    controller.abort();
    setTimeout(() => process.exit(0), 2000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await ingest;
}

main().catch((err: unknown) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
