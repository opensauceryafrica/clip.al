import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { planLimits, resolvePlan } from '@clipal/billing';
import { keys, rateLimit, redis } from '@clipal/cache';
import { type SessionUser } from '@clipal/auth';
import { and, db, eq, isNull, schema } from '@clipal/db';

/**
 * API-key authentication for the public `/api/v1` surface (spec §9, §14.2).
 *
 * Keys carry 256 bits of entropy, so a SHA-256 of the full key plus a
 * timing-safe compare is the correct verification primitive — argon2 (used for
 * passwords) is deliberately NOT used here. The cheap `prefix` column is indexed
 * and used to narrow the lookup to a single row before the constant-time compare.
 */

/** Scopes an API key may carry; endpoints declare the one they require. */
export const API_SCOPES = ['links:read', 'links:write', 'analytics:read'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/** Stable, alphabetical metadata for rendering scope checkboxes in the UI. */
export const API_SCOPE_META: Record<ApiScope, { label: string; description: string }> = {
  'links:read': { label: 'links:read', description: 'Read links and their metadata.' },
  'links:write': { label: 'links:write', description: 'Create, update, and delete links.' },
  'analytics:read': { label: 'analytics:read', description: 'Read click analytics.' },
};

/** Environment marker baked into the plaintext key (`clpl_live_…` / `clpl_test_…`). */
export type KeyEnv = 'live' | 'test';

/** Number of random bytes → ~43 base62 chars (well over 256 bits of entropy). */
const KEY_RANDOM_BYTES = 32;
/** How many leading chars of the plaintext are stored/displayed as the `prefix`. */
const PREFIX_LENGTH = 12;
/** Throttle `last_used_at` writes to at most once per this many seconds per key. */
const LAST_USED_THROTTLE_SECONDS = 60;
/** Short burst window guarding against per-key floods, independent of the monthly cap. */
const BURST_LIMIT = 60;
const BURST_WINDOW_SECONDS = 60;

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function base62(bytes: Buffer): string {
  // Simple, unbiased-enough mapping: one base62 char per byte (256 % 62 bias is
  // negligible for key material — entropy comes from the 32 raw bytes either way).
  let out = '';
  for (const b of bytes) out += BASE62[b % 62];
  return out;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface GeneratedKey {
  /** Full secret, shown to the user exactly once. */
  plaintext: string;
  /** Indexed lookup prefix (`clpl_live_a1b2`), safe to persist and display. */
  prefix: string;
  /** SHA-256 hex of the full plaintext — what we store and compare against. */
  keyHash: string;
}

/**
 * Mint a new API key. The plaintext is `clpl_<env>_<base62>` and is the ONLY
 * place the secret ever exists in cleartext — the caller must surface it once
 * and then discard it; only `prefix` + `keyHash` are persisted.
 */
export function generateApiKey(envName: KeyEnv): GeneratedKey {
  const random = base62(randomBytes(KEY_RANDOM_BYTES));
  const plaintext = `clpl_${envName}_${random}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, PREFIX_LENGTH),
    keyHash: sha256Hex(plaintext),
  };
}

/** Constant-time hex-digest comparison (lengths always equal for sha256 hex). */
function hashesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** The error envelope shared by every `/api/v1` + API-auth failure (per CONTRACTS). */
export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'invalid_request'
  | 'plan_required';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): AuthFailure {
  const error: ApiErrorBody['error'] = details === undefined
    ? { code, message }
    : { code, message, details };
  return { ok: false, status, body: { error } };
}

export interface AuthSuccess {
  ok: true;
  user: SessionUser;
  key: schema.ApiKey;
}

export interface AuthFailure {
  ok: false;
  status: number;
  body: ApiErrorBody;
}

export type AuthResult = AuthSuccess | AuthFailure;

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token || null;
}

/** Best-effort, throttled `last_used_at` bump — never blocks/breaks the request. */
async function touchLastUsed(keyId: string): Promise<void> {
  const guard = `apikey:lastused:${keyId}`;
  try {
    // SET NX EX: only the first caller in the window wins and writes the row.
    const won = await redis.set(guard, '1', 'EX', LAST_USED_THROTTLE_SECONDS, 'NX');
    if (won) {
      await db
        .update(schema.apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.apiKeys.id, keyId));
    }
  } catch {
    // Redis or DB blip — usage stamping is advisory, swallow it.
  }
}

/**
 * Authenticate an incoming API request by its `Authorization: Bearer clpl_…`
 * header and (optionally) assert a required scope.
 *
 * Flow (spec §9):
 *  1. parse bearer → 401 `unauthorized` if missing/malformed
 *  2. index lookup by `prefix`, then timing-safe `sha256(full) === keyHash`
 *  3. reject revoked / expired keys → 401 `unauthorized`
 *  4. assert `requiredScope ∈ key.scopes` → 403 `forbidden`
 *  5. rate-limit: a short per-key burst window (`rate_limited`) AND the plan's
 *     monthly request budget (`planLimits.apiRequestsPerMonth`) → 429
 *  6. throttled `last_used_at` bump
 */
export async function authenticateApiRequest(
  request: Request,
  requiredScope?: ApiScope,
): Promise<AuthResult> {
  const token = bearerToken(request);
  if (!token || !token.startsWith('clpl_')) {
    return fail(401, 'unauthorized', 'Missing or malformed API key.');
  }

  const prefix = token.slice(0, PREFIX_LENGTH);
  const [key] = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.prefix, prefix))
    .limit(1);

  // Hash the candidate even when no row matched, then compare against a dummy of
  // equal length, so a miss and a wrong-secret take the same path/time.
  const candidateHash = sha256Hex(token);
  if (!key || !hashesMatch(candidateHash, key.keyHash)) {
    return fail(401, 'unauthorized', 'Invalid API key.');
  }

  if (key.revokedAt) return fail(401, 'unauthorized', 'This API key has been revoked.');
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    return fail(401, 'unauthorized', 'This API key has expired.');
  }

  if (requiredScope && !key.scopes.includes(requiredScope)) {
    return fail(403, 'forbidden', `This API key is missing the '${requiredScope}' scope.`, {
      requiredScope,
    });
  }

  // Load the owning user; a key whose user vanished or is not active is unusable.
  const [owner] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      role: schema.users.role,
      status: schema.users.status,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, key.userId))
    .limit(1);
  if (!owner || owner.status !== 'active') {
    return fail(401, 'unauthorized', 'The account for this API key is unavailable.');
  }

  // Per-key burst guard (sliding window). Cheap, runs before the monthly bucket.
  const burst = await rateLimit(
    keys.rateLimit('apikey:burst', key.id),
    BURST_LIMIT,
    BURST_WINDOW_SECONDS,
  ).catch(() => ({ ok: true, remaining: BURST_LIMIT, limit: BURST_LIMIT }));
  if (!burst.ok) {
    return fail(429, 'rate_limited', 'Too many requests; slow down.', {
      retryAfterSeconds: BURST_WINDOW_SECONDS,
    });
  }

  // Plan monthly budget. INCR a UTC-month bucket and compare to the plan cap.
  const plan = await resolvePlan(key.userId);
  const monthlyCap = planLimits(plan).apiRequestsPerMonth;
  if (monthlyCap <= 0) {
    return fail(402, 'plan_required', 'API access is not available on your plan.', { plan });
  }
  const bucketKey = `usage:api:${key.userId}:${monthBucket(new Date())}`;
  let monthCount = 0;
  try {
    monthCount = await redis.incr(bucketKey);
    if (monthCount === 1) await redis.expire(bucketKey, MONTH_BUCKET_TTL_SECONDS);
  } catch {
    monthCount = 0; // Redis down — fail open on the monthly cap, burst still applied.
  }
  if (monthCount > monthlyCap) {
    return fail(429, 'rate_limited', 'Monthly API request limit reached.', {
      limit: monthlyCap,
      plan,
    });
  }

  void touchLastUsed(key.id);

  const user: SessionUser = {
    id: owner.id,
    email: owner.email,
    role: owner.role,
    status: owner.status,
    displayName: owner.displayName,
  };
  return { ok: true, user, key };
}

/** ~13 months so an over-by-one read of last month's bucket still resolves. */
const MONTH_BUCKET_TTL_SECONDS = 60 * 60 * 24 * 400;

/** UTC `YYYYMM`, matching @clipal/billing's link-usage period keying. */
function monthBucket(at: Date): string {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth() + 1;
  return `${y}${m < 10 ? '0' : ''}${m}`;
}

/**
 * Look up the live API keys for `userId` (most recent first). Convenience for the
 * management pages; never returns the secret (it is not stored in cleartext).
 */
export async function listApiKeysForUser(userId: string): Promise<schema.ApiKey[]> {
  return db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.userId, userId))
    .orderBy(schema.apiKeys.createdAt);
}

/** Count of a user's non-revoked keys (for plan-limit checks at creation time). */
export async function countActiveApiKeys(userId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.apiKeys.id })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.userId, userId), isNull(schema.apiKeys.revokedAt)));
  return rows.length;
}
