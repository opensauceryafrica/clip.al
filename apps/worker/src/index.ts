import { captureException, flushSentry, initSentry } from '@clipal/observability';
import { startHealthServer } from './health';
import { initGeo } from './lib/geo';
import { getDailySalt } from './lib/salt';
import { runClickIngest } from './loops/click-ingest';
import { runBulkImport } from './loops/bulk-import';
import { runBillingProcessor } from './loops/billing-processor';
import { env } from '@clipal/config';
import { refreshGeo } from './loops/geo-refresh';
import { purgeDeletedAccounts } from './loops/purge';
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
  // Init early so the SDK's unhandledRejection/uncaughtException handlers are
  // armed before any loop starts (no-op + one [boot] line unless SENTRY_DSN set).
  initSentry('worker');
  startHealthServer(Number(process.env['WORKER_HEALTH_PORT'] ?? 9090));
  await initGeo();

  const controller = new AbortController();

  // Scheduled jobs.
  every('rescan', MINUTE, runRescan); // §18.2 rolling URL re-scan
  every('salt-rotate', 60 * MINUTE, async () => {
    await getDailySalt(); // §18.4 keep the current UTC-day IP salt warm
  });
  every('reap-auth-codes', 5 * MINUTE, reapAuthCodes); // §18.5
  every('billing-processor', 15_000, runBillingProcessor); // §7 webhook drain safety net
  every('reap-sessions', 24 * 60 * MINUTE, reapSessions); // §18.6
  every('account-purge', 24 * 60 * MINUTE, purgeDeletedAccounts); // §18.x daily hard-delete

  // §18.3 GeoLite2 refresh — only when a license key is configured. Runs at boot
  // (downloads if missing/stale) and weekly thereafter. No-op + one boot line
  // otherwise, mirroring the Sentry/GSB pattern.
  if (env.MAXMIND_LICENSE_KEY) {
    every('geo-refresh', 7 * 24 * 60 * MINUTE, refreshGeo);
  } else {
    console.warn(
      '[boot] MAXMIND_LICENSE_KEY not set — GeoLite2 auto-refresh disabled (geo best-effort, country=ZZ)',
    );
  }

  // Long-running stream consumers (§18.1).
  const ingest = runClickIngest(controller.signal);
  const bulkImport = runBulkImport(controller.signal);

  const shutdown = (signal: string): void => {
    console.log(`[worker] ${signal} — shutting down`);
    controller.abort();
    // Give in-flight work 2s to settle, then flush buffered Sentry events.
    setTimeout(() => {
      void flushSentry(1500).finally(() => process.exit(0));
    }, 2000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await Promise.all([ingest, bulkImport]);
}

main().catch((err: unknown) => {
  console.error('[worker] fatal', err);
  captureException(err, { fatal: true });
  void flushSentry(2000).finally(() => process.exit(1));
});
