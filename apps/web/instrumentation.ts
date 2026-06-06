/**
 * Next.js server boot hook. Loads the reserved-slug and blocked-domain sets into
 * Redis once at startup (§14.12, §14.1). Guarded to the Node runtime so the ORM
 * is never pulled into the Edge runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { bootstrapSecuritySets } = await import('@clipal/shorten');
      await bootstrapSecuritySets();
      console.log('[boot] reserved slugs + domain blocklist loaded into Redis');
    } catch (err) {
      // Don't crash boot if Redis/Postgres aren't ready yet; shorten validation
      // also checks the in-memory reserved list as a fallback.
      console.error('[boot] failed to load security sets', err);
    }

    const { isGsbConfigured } = await import('@clipal/safety');
    if (!isGsbConfigured()) {
      console.warn(
        '[boot] GSB_API_KEY not configured — submission-time URL safety scanning disabled; relying on blocklist + SSRF guard only',
      );
    }

    const { env } = await import('@clipal/config');
    if (env.AUTH_DEV_LOG_CODES_ON_FAIL) {
      console.warn(
        '[boot] AUTH_DEV_LOG_CODES_ON_FAIL=true — 6-digit auth codes will be printed to stderr WHEN EMAIL DELIVERY FAILS. DEV ONLY; never enable in production.',
      );
    }
  }
}
