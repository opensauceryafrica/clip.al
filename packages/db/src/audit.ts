import type { DB } from './client';
import { auditLog, type NewAuditLogEntry } from './schema/audit-log';

/**
 * The ONLY write path for audit_log. Append-only: there is deliberately no
 * update/delete helper. `actorId: null` denotes a system action.
 */
export async function recordAudit(
  db: DB,
  entry: Omit<NewAuditLogEntry, 'id' | 'createdAt'>,
): Promise<void> {
  await db.insert(auditLog).values(entry);
}
