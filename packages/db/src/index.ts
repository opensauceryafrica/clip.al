export * from './schema';
export { db, schema, sqlClient, type DB } from './client';
export { recordAudit } from './audit';

// Re-export the drizzle operators app code reaches for most, so callers have a
// single import source (`@clipal/db`) for both tables and query builders.
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
export type { SQL } from 'drizzle-orm';
