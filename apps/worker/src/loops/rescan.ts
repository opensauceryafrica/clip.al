import { keys, redis } from '@clipal/cache';
import { env } from '@clipal/config';
import { and, db, eq, isNull, links, lt, ne, or, recordAudit, users } from '@clipal/db';
import { sendLinkDisabled } from '@clipal/email';
import { scanUrls } from '@clipal/safety';

const RESCAN_INTERVAL_DAYS = 7;
const BATCH = 500;

/**
 * Rolling URL re-scan (§18.2). Every minute, pick up to 500 not-already-malicious
 * links that are unchecked or last checked >7 days ago, batch them through Google
 * Safe Browsing, and persist the result. Newly-malicious links are disabled, their
 * hot cache is invalidated (instant 410), the action is audited (system actor),
 * and the owner is emailed.
 */
export async function runRescan(): Promise<void> {
  // Without a GSB key we cannot actually verify; skip rather than falsely mark clean.
  if (!env.GSB_API_KEY) return;

  const cutoff = new Date(Date.now() - RESCAN_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db
    .select({
      id: links.id,
      code: links.code,
      destinationUrl: links.destinationUrl,
      ownerId: links.ownerId,
    })
    .from(links)
    .where(
      and(
        ne(links.safetyState, 'malicious'),
        or(isNull(links.safetyCheckedAt), lt(links.safetyCheckedAt, cutoff)),
      ),
    )
    .limit(BATCH);

  if (candidates.length === 0) return;

  const threatsByUrl = await scanUrls(candidates.map((c) => c.destinationUrl));
  // null = GSB unconfigured or the request failed (warning already logged). Skip
  // this pass so the candidates keep their state and are re-scanned next minute,
  // rather than being falsely marked clean.
  if (threatsByUrl === null) return;
  const now = new Date();

  for (const link of candidates) {
    const threats = threatsByUrl.get(link.destinationUrl) ?? [];
    const malicious = threats.length > 0;

    await db
      .update(links)
      .set({
        safetyState: malicious ? 'malicious' : 'clean',
        safetyThreats: malicious ? threats : null,
        safetyCheckedAt: now,
        ...(malicious ? { status: 'disabled_by_safety' as const } : {}),
      })
      .where(eq(links.id, link.id));

    if (!malicious) continue;

    // Instant 410 on the hot path.
    await redis.set(keys.hotLink(link.code), 'DISABLED', 'EX', 300).catch(() => {});
    await recordAudit(db, {
      actorId: null,
      action: 'link.disable_safety',
      targetType: 'link',
      targetId: link.id,
      metadata: { code: link.code, threats },
    });

    if (link.ownerId) {
      const [owner] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, link.ownerId))
        .limit(1);
      if (owner) {
        await sendLinkDisabled(owner.email, {
          code: link.code,
          destination: link.destinationUrl,
          threats,
        }).catch((e: unknown) => console.error('[rescan] notify failed', e));
      }
    }
  }

  console.log(`[rescan] checked ${candidates.length} links`);
}
