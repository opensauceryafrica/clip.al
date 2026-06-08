import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inet } from './columns';
import { linkStatus, safetyState } from './enums';
import { users } from './users';

export const links = pgTable(
  'links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The short slug. 7-char base62 by default; owners can set a custom back-half.
    code: text('code').notNull(),
    // Back-halves this link used before (capped). They keep redirecting here, and
    // analytics span them. GIN-indexed for the redirect alias lookup.
    previousCodes: text('previous_codes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    destinationUrl: text('destination_url').notNull(),
    // null for anonymous links.
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    creatorIp: inet('creator_ip'),
    // sha256 of the creator's UA — abuse correlation without retaining raw UA.
    creatorUaHash: text('creator_ua_hash'),
    status: linkStatus('status').notNull().default('active'),
    safetyState: safetyState('safety_state').notNull().default('unchecked'),
    safetyCheckedAt: timestamp('safety_checked_at', { withTimezone: true }),
    // array of threat types from GSB or our scanner.
    safetyThreats: jsonb('safety_threats').$type<string[]>(),
    interstitialRequired: boolean('interstitial_required').notNull().default(true),
    reportCount: integer('report_count').notNull().default(0),
    // denormalized counter, updated by the worker's batch flusher (§10).
    clicksTotal: bigint('clicks_total', { mode: 'number' }).notNull().default(0),
    lastClickAt: timestamp('last_click_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('links_code_key').on(t.code),
    // Redirect alias lookup: resolve an old back-half via `previous_codes @> [code]`.
    index('links_previous_codes_gin').using('gin', t.previousCodes),
    // owner dashboard: most-recent-first listing per owner.
    index('links_owner_created_idx').on(t.ownerId, t.createdAt.desc()),
    index('links_status_idx').on(t.status),
    // re-scan worker pick list (§18.2).
    index('links_safety_rescan_idx').on(t.safetyState, t.safetyCheckedAt),
    // admin abuse queue: hottest reports first, active links only.
    index('links_report_count_active_idx')
      .on(t.reportCount.desc())
      .where(sql`${t.status} = 'active'`),
  ],
);

export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
