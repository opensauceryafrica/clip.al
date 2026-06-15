import 'server-only';
import { createHash } from 'node:crypto';
import { redis } from '@clipal/cache';
import type { ApiErrorBody, ApiErrorCode, AuthFailure } from './api-auth';

/**
 * Shared response plumbing for the public `/api/v1` surface (spec §5, §9, §13).
 *
 * Everything here exists so each route handler stays tiny and consistent:
 *  - one JSON envelope for success AND the `{ error: { code, message } }` shape
 *  - `Idempotency-Key` replay of a prior response for unsafe (POST) requests
 *  - opaque cursor pagination over `(updatedAt, id)`
 *
 * No handler should hand-build a `Response` for an error — call `apiError` (or
 * forward an `AuthFailure` from `authenticateApiRequest`) so the envelope and
 * status code never drift.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

/** Status code each error code maps to (single source of truth). */
const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  invalid_request: 400,
  plan_required: 402,
};

/** A successful JSON body. Extra headers (e.g. cache) merge over the defaults. */
export function apiJson(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store', ...(init?.headers ?? {}) },
  });
}

/** Build the canonical error envelope `Response` for `code` (+ optional details). */
export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
  statusOverride?: number,
): Response {
  const error: ApiErrorBody['error'] =
    details === undefined ? { code, message } : { code, message, details };
  return new Response(JSON.stringify({ error }), {
    status: statusOverride ?? STATUS_FOR_CODE[code],
    headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
  });
}

/** Replay an `AuthFailure` from `authenticateApiRequest` as a `Response`. */
export function authFailureResponse(failure: AuthFailure): Response {
  return new Response(JSON.stringify(failure.body), {
    status: failure.status,
    headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
  });
}

// ── Validation ───────────────────────────────────────────────────────────────

/** Shape we depend on from a zod schema without importing zod into this file. */
interface ZodLike<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: ZodErrorLike };
}
interface ZodErrorLike {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}

/**
 * Validate `data` against a zod schema, returning either the parsed value or a
 * ready-to-return `invalid_request` envelope. Keeps every handler's validation
 * branch a single line.
 */
export function validate<T>(
  schema: ZodLike<T>,
  data: unknown,
): { ok: true; value: T } | { ok: false; response: Response } {
  const parsed = schema.safeParse(data);
  if (parsed.success) return { ok: true, value: parsed.data };
  const details = parsed.error.issues.map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
  }));
  return {
    ok: false,
    response: apiError('invalid_request', 'The request body or parameters are invalid.', details),
  };
}

// ── Cursor pagination ──────────────────────────────────────────────────────────

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export interface Cursor {
  /** The `updated_at` of the last row on the previous page (ms since epoch). */
  updatedAt: number;
  /** The `id` of the last row on the previous page (tiebreaker). */
  id: string;
}

/** Encode a `(updatedAt, id)` pair into an opaque base64url cursor. */
export function encodeCursor(updatedAt: Date, id: string): string {
  const raw = JSON.stringify({ u: updatedAt.getTime(), i: id });
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/** Decode an opaque cursor; returns null on any malformed input (never throws). */
export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, 'base64url').toString('utf8');
    const obj = JSON.parse(raw) as { u?: unknown; i?: unknown };
    if (typeof obj.u !== 'number' || !Number.isFinite(obj.u) || typeof obj.i !== 'string') {
      return null;
    }
    return { updatedAt: obj.u, id: obj.i };
  } catch {
    return null;
  }
}

/** Clamp a raw `limit` query param into `[1, MAX_PAGE_LIMIT]`, defaulting sanely. */
export function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_PAGE_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.floor(n), MAX_PAGE_LIMIT);
}

// ── Idempotency (POST replay) ──────────────────────────────────────────────────

/** How long a stored idempotent response is replayed (spec §9: 24h). */
const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;

interface StoredIdempotentResponse {
  status: number;
  body: string;
}

function idempotencyRedisKey(userId: string, key: string): string {
  // Namespace by user so two accounts can reuse the same client-chosen key.
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 32);
  return `api:idem:${userId}:${digest}`;
}

/**
 * Look up a previously-stored response for this `(user, Idempotency-Key)`. When
 * present the caller should return it verbatim — the original request already
 * ran. Returns null when there is no key header or no stored entry.
 */
export async function replayIdempotent(
  userId: string,
  idempotencyKey: string | null,
): Promise<Response | null> {
  if (!idempotencyKey) return null;
  try {
    const stored = await redis.get(idempotencyRedisKey(userId, idempotencyKey));
    if (!stored) return null;
    const parsed = JSON.parse(stored) as StoredIdempotentResponse;
    return new Response(parsed.body, {
      status: parsed.status,
      headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' },
    });
  } catch {
    return null;
  }
}

/**
 * Persist a freshly-produced response under the idempotency key (best-effort,
 * 24h). Stores the serialized body + status so a later replay is byte-identical.
 * The passed `Response` is consumed; the returned clone is what the handler
 * should actually return.
 */
export async function storeIdempotent(
  userId: string,
  idempotencyKey: string | null,
  response: Response,
): Promise<Response> {
  if (!idempotencyKey) return response;
  const clone = response.clone();
  try {
    const body = await clone.text();
    const payload: StoredIdempotentResponse = { status: response.status, body };
    await redis.set(
      idempotencyRedisKey(userId, idempotencyKey),
      JSON.stringify(payload),
      'EX',
      IDEMPOTENCY_TTL_SECONDS,
      'NX',
    );
  } catch {
    // Storing is advisory — the caller still gets its response either way.
  }
  return response;
}
