import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { inet } from './columns';
import { users } from './users';

/**
 * Append-only. The app layer never UPDATEs or DELETEs this table — there are no
 * mutate helpers for it in @clipal/db beyond insert. A null `actorId` denotes a
 * system/automated action (e.g. the safety re-scan worker disabling a link).
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // e.g. 'link.disable', 'user.suspend', 'domain.block'
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_actor_created_idx').on(t.actorId, t.createdAt.desc()),
    index('audit_log_target_idx').on(t.targetType, t.targetId),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
