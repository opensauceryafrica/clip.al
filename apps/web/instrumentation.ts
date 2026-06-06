/**
 * Next.js server boot hook. Initializes error tracking, then loads the
 * reserved-slug and blocked-domain sets into Redis (§14.12, §14.1). Guarded to
 * the Node runtime so neither the ORM nor @sentry/node is pulled into Edge.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSentry } = await import('@clipal/observability');
    initSentry('web');

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

/**
 * Next 15 server error hook — fires for errors in route handlers, server
 * components, and server actions. Reported to Sentry (Node runtime only;
 * @sentry/node can't run on Edge). We strip the query string from the path (it
 * can carry an email, e.g. /verify?email=…) and beforeSend scrubs the rest.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { captureException } = await import('@clipal/observability');
  const route = typeof request.path === 'string' ? request.path.split('?')[0] : undefined;
  captureException(error, route ? { route, method: request.method } : undefined);
}
