import { z } from 'zod';

/**
 * Server-only, boot-time-validated environment.
 *
 * NEVER import this from a client component — it reads secrets. It is safe in
 * server components, route handlers, server actions, the worker, and scripts.
 *
 * Validation runs once at module load. A bad/missing required var fails fast
 * with a readable error instead of surfacing as a confusing runtime crash deep
 * in a request.
 */

const nodeEnv = z.enum(['development', 'production', 'test']);

const hexSecret = z
  .string()
  .regex(/^[0-9a-fA-F]+$/, 'must be hex')
  .min(64, 'must be at least 32 bytes (64 hex chars); 64 bytes recommended');

const trimmedUrl = z.string().url();

const schema = z
  .object({
    // App
    NODE_ENV: nodeEnv.default('development'),
    APP_URL: trimmedUrl.default('http://localhost:3000'),
    PORT: z.coerce.number().int().positive().default(3000),
    SESSION_SECRET: hexSecret,
    COOKIE_DOMAIN: z.string().min(1).default('localhost'),

    // Postgres
    DATABASE_URL: z.string().startsWith('postgres'),

    // Redis
    REDIS_URL: z.string().startsWith('redis'),

    // ClickHouse
    CLICKHOUSE_URL: trimmedUrl.default('http://localhost:8123'),
    CLICKHOUSE_USER: z.string().default('default'),
    CLICKHOUSE_PASSWORD: z.string().default(''),
    CLICKHOUSE_DATABASE: z.string().default('clipal'),

    // MinIO / S3
    S3_ENDPOINT: trimmedUrl.default('http://localhost:9000'),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('clipal'),
    S3_ACCESS_KEY: z.string().default(''),
    S3_SECRET_KEY: z.string().default(''),
    S3_PUBLIC_URL: trimmedUrl.default('http://localhost:9000/clipal'),

    // Resend
    RESEND_API_KEY: z.string().default(''),
    EMAIL_FROM: z.string().default('clip.al <no-reply@clip.al>'),

    // Turnstile
    TURNSTILE_SITE_KEY: z.string().default(''),
    TURNSTILE_SECRET_KEY: z.string().default(''),

    // Google Safe Browsing
    GSB_API_KEY: z.string().default(''),

    // Error tracking (optional)
    SENTRY_DSN: z.string().default(''),

    // Rate limits
    RATE_LIMIT_ANON_SHORTEN_PER_HOUR: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_ANON_SHORTEN_PER_DAY: z.coerce.number().int().positive().default(50),
    RATE_LIMIT_AUTHED_SHORTEN_PER_HOUR: z.coerce.number().int().positive().default(200),
    RATE_LIMIT_AUTHED_SHORTEN_PER_DAY: z.coerce.number().int().positive().default(2000),
    RATE_LIMIT_AUTH_CODE_PER_HOUR: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_AUTH_CODE_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_VERIFY_PER_HOUR: z.coerce.number().int().positive().default(10),

    // Worker / GeoIP
    GEOIP_DIR: z.string().default('/data/geoip'),
    MAXMIND_LICENSE_KEY: z.string().default(''),

    // Admin bootstrap
    INITIAL_ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
    INITIAL_ADMIN_NAME: z.string().default('Owner'),

    // Migration
    ABBREFY_EXPORT_PATH: z.string().default('/data/abbrefy-export.json'),

    // DEV ONLY (see .env.example). When email delivery FAILS, log the 6-digit
    // auth code to stderr. True only for the literal "true"/"1"; default false.
    AUTH_DEV_LOG_CODES_ON_FAIL: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
  })
  .superRefine((val, ctx) => {
    // Production must not run with placeholder/missing safety controls.
    if (val.NODE_ENV === 'production') {
      if (!val.TURNSTILE_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TURNSTILE_SECRET_KEY'],
          message: 'required in production (CAPTCHA gate)',
        });
      }
      if (!val.GSB_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GSB_API_KEY'],
          message: 'required in production (URL safety scan)',
        });
      }
    }
  });

export type Env = z.infer<typeof schema>;

function load(): Env {
  // In test runs we relax the few hard requirements so unit tests of pure
  // functions don't need a populated environment.
  const source: NodeJS.ProcessEnv = { ...process.env };
  if (source.NODE_ENV === 'test') {
    source.SESSION_SECRET ??= '0'.repeat(128);
    source.DATABASE_URL ??= 'postgres://test@localhost:5432/test';
    source.REDIS_URL ??= 'redis://localhost:6379';
  }

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
    // Do not print values — only the offending keys.
    throw new Error(
      `Invalid environment configuration:\n${lines.join('\n')}\n` +
        `See .env.example for the full, documented variable list.`,
    );
  }
  return parsed.data;
}

export const env: Env = load();

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/**
 * The public origin for building ABSOLUTE URLs (share links, email links,
 * cross-origin redirects). Always derived from APP_URL — NEVER from the request
 * Host header (which inside Docker/behind a proxy can be a container hostname).
 * Same-origin redirects should prefer a relative path; use this only when an
 * absolute URL is genuinely required. No trailing slash.
 */
export function getPublicBaseUrl(): string {
  return env.APP_URL.replace(/\/+$/, '');
}

/** Convenience: resolved rate-limit windows (limit + window in seconds). */
export const limits = {
  anonShorten: [
    { limit: env.RATE_LIMIT_ANON_SHORTEN_PER_HOUR, windowSec: 3600 },
    { limit: env.RATE_LIMIT_ANON_SHORTEN_PER_DAY, windowSec: 86_400 },
  ],
  authedShorten: [
    { limit: env.RATE_LIMIT_AUTHED_SHORTEN_PER_HOUR, windowSec: 3600 },
    { limit: env.RATE_LIMIT_AUTHED_SHORTEN_PER_DAY, windowSec: 86_400 },
  ],
  authCodePerEmail: { limit: env.RATE_LIMIT_AUTH_CODE_PER_HOUR, windowSec: 3600 },
  authCodePerIp: { limit: env.RATE_LIMIT_AUTH_CODE_PER_IP_PER_HOUR, windowSec: 3600 },
  verifyPerEmail: { limit: env.RATE_LIMIT_VERIFY_PER_HOUR, windowSec: 3600 },
} as const;
