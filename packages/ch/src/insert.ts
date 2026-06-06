import { ch } from './client';
import type { ClickRow } from './types';

/** Batch-insert click rows (JSONEachRow). No-op on an empty batch. */
export async function insertClicks(rows: readonly ClickRow[]): Promise<void> {
  if (rows.length === 0) return;
  await ch.insert({
    table: 'clicks',
    values: rows,
    format: 'JSONEachRow',
  });
}
