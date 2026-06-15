'use server';

import { randomUUID } from 'node:crypto';
import { hashPassword } from '@clipal/auth';
import { keys, redis } from '@clipal/cache';
import { planLimits, resolvePlan } from '@clipal/billing';
import { CUSTOM_SLUG_REGEX } from '@clipal/config/constants';
import { db, recordAudit } from '@clipal/db';
import { validateDestination } from '@clipal/safety';
import { parse as parseCsv } from 'csv-parse/sync';
import { requireUser } from '@/lib/auth';

/**
 * Return shape for {@link startBulkImportAction}.
 *  - `{ ok, importId }` on a queued import (the UI then opens the SSE progress).
 *  - `{ reason: 'plan_required' }` when the plan's `bulkImportMax` is 0 (free).
 *  - `{ error, errorCsv }` when ANY row is malformed — the whole file is rejected
 *    and `errorCsv` is a downloadable `row,error` report.
 *  - `{ error }` for everything else (no file, parse failure, over the cap).
 */
export interface BulkImportState {
  ok?: boolean;
  importId?: string;
  reason?: 'plan_required';
  error?: string;
  /** A CSV (`row,error`) of every rejected row, for download. */
  errorCsv?: string;
}

/** A parsed + validated row, ready to enqueue. */
interface ValidRow {
  destinationUrl: string;
  slug?: string;
  passwordHash?: string;
  expiresAt?: string;
  tags?: string;
  note?: string;
}

interface RowError {
  /** 1-based row number as it appears in the source file (excluding header). */
  row: number;
  error: string;
}

/** Serialize rejected rows to a `row,error` CSV (RFC4180-quoted). */
function toErrorCsv(errors: RowError[]): string {
  const esc = (v: string): string => `"${v.replace(/"/g, '""')}"`;
  const lines = ['row,error', ...errors.map((e) => `${e.row},${esc(e.error)}`)];
  return lines.join('\r\n');
}

/**
 * Bulk CSV import (§8, AC7). Caps rows by the plan's `bulkImportMax` (free=0 →
 * `plan_required`). Parses the CSV and validates EVERY row up front; if any row
 * is malformed the entire file is rejected with an `errorCsv` so nothing is half-
 * imported. On success it mints an `importId`, seeds the progress hash, and XADDs
 * one stream entry per valid row for the worker to drain (where the SSRF /
 * blocklist / Safe-Browsing checks run, throttled, via `createLink`).
 */
export async function startBulkImportAction(
  _prev: BulkImportState,
  formData: FormData,
): Promise<BulkImportState> {
  const user = await requireUser();
  const plan = await resolvePlan(user.id);

  const max = planLimits(plan).bulkImportMax;
  if (max <= 0) {
    return { reason: 'plan_required', error: 'Bulk import is available on paid plans.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a CSV file to import.' };
  }

  const text = await file.text();

  let records: Record<string, string>[];
  try {
    records = parseCsv(text, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as Record<string, string>[];
  } catch {
    return { error: 'That file isn’t valid CSV. Check the formatting and try again.' };
  }

  if (records.length === 0) {
    return { error: 'The file has no data rows.' };
  }
  if (records.length > max) {
    return {
      error: `That file has ${records.length} rows, over your plan limit of ${max}.`,
    };
  }

  // ── Validate every row; reject the whole file on the first malformed batch. ──
  const valid: ValidRow[] = [];
  const errors: RowError[] = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const rowNum = i + 1;

    const destinationRaw = (rec['destination_url'] ?? '').trim();
    // Synchronous syntax/SSRF/scheme check only (no network here). The worker
    // re-runs the FULL pipeline (blocklist + Safe Browsing) per row.
    const syntax = validateDestination(destinationRaw);
    if (!syntax.ok) {
      errors.push({ row: rowNum, error: `destination_url: ${syntax.message}` });
      continue;
    }

    const row: ValidRow = { destinationUrl: syntax.value.url };

    const slug = (rec['slug'] ?? '').trim();
    if (slug) {
      if (!CUSTOM_SLUG_REGEX.test(slug)) {
        errors.push({ row: rowNum, error: 'slug: invalid back-half format' });
        continue;
      }
      row.slug = slug;
    }

    const expiresAt = (rec['expires_at'] ?? '').trim();
    if (expiresAt) {
      const ts = Date.parse(expiresAt);
      if (Number.isNaN(ts)) {
        errors.push({ row: rowNum, error: 'expires_at: not a valid date' });
        continue;
      }
      if (ts <= Date.now()) {
        errors.push({ row: rowNum, error: 'expires_at: must be in the future' });
        continue;
      }
      row.expiresAt = new Date(ts).toISOString();
    }

    const tags = (rec['tags'] ?? '').trim();
    if (tags) row.tags = tags;

    const note = (rec['note'] ?? '').trim();
    if (note) row.note = note;

    // Hash the password last (argon2 is expensive) and only when present + the
    // row is otherwise valid, so a malformed file costs no hashing.
    const password = (rec['password'] ?? '').trim();
    if (password) row.passwordHash = await hashPassword(password);

    valid.push(row);
  }

  if (errors.length > 0) {
    return {
      error: `${errors.length} of ${records.length} rows are invalid. Fix them and re-upload.`,
      errorCsv: toErrorCsv(errors),
    };
  }

  // ── Queue: seed progress hash, then XADD one entry per valid row. ───────────
  const importId = randomUUID();
  const progressKey = keys.bulkProgress(importId);

  await redis.hset(progressKey, {
    total: String(valid.length),
    done: '0',
    ok: '0',
    failed: '0',
    status: 'running',
  });
  // Self-expire finished imports (24h) so progress hashes don't accumulate.
  await redis.expire(progressKey, 24 * 60 * 60);

  for (const row of valid) {
    const fields: string[] = [
      'importId',
      importId,
      'ownerId',
      user.id,
      'destination_url',
      row.destinationUrl,
    ];
    if (row.slug) fields.push('slug', row.slug);
    if (row.passwordHash) fields.push('password_hash', row.passwordHash);
    if (row.expiresAt) fields.push('expires_at', row.expiresAt);
    if (row.tags) fields.push('tags', row.tags);
    if (row.note) fields.push('note', row.note);

    await redis.xadd(keys.bulkStream, 'MAXLEN', '~', 1_000_000, '*', ...fields);
  }

  await recordAudit(db, {
    actorId: user.id,
    action: 'link.bulk_import_started',
    targetType: 'user',
    targetId: user.id,
    metadata: { importId, rows: valid.length, plan },
  });

  return { ok: true, importId };
}
