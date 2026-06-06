import { customType } from 'drizzle-orm/pg-core';

/**
 * Postgres `citext` — case-insensitive text. Used for email columns so unique
 * constraints and lookups are case-folded without manual lower() everywhere.
 * Requires `CREATE EXTENSION citext` (done by the migrator before tables apply).
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * Postgres `inet` — stores IPv4/IPv6 addresses. We keep raw IPs only
 * transiently (auth_codes, deleted on consume/expiry); click analytics store a
 * salted hash, never the raw IP (§14.10).
 */
export const inet = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'inet';
  },
});
