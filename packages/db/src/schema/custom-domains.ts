import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { customDomainStatus } from './enums';
import { users } from './users';

export const customDomains = pgTable(
  'custom_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // lowercased host, e.g. `go.brand.com`.
    domain: text('domain').notNull().unique(),
    status: customDomainStatus('status').notNull().default('pending_dns'),
    // random hex; published as TXT `_clipal-verify.<domain>`.
    verificationToken: text('verification_token').notNull(),
    dnsVerifiedAt: timestamp('dns_verified_at', { withTimezone: true }),
    tlsIssuedAt: timestamp('tls_issued_at', { withTimezone: true }),
    lastCheckAt: timestamp('last_check_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // `domain` already has a unique index from `.unique()`; this non-unique index
  // is the Caddy on-demand-TLS allowlist lookup by host + status.
  (t) => [index('custom_domains_status_idx').on(t.status)],
);

export type CustomDomain = typeof customDomains.$inferSelect;
export type NewCustomDomain = typeof customDomains.$inferInsert;
