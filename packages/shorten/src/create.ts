import { createHash } from 'node:crypto';
import { isReservedSlug } from '@clipal/cache';
import { SLUG_MAX_RETRIES } from '@clipal/config/constants';
import { db, links, recordAudit } from '@clipal/db';
import {
  checkBlocklist,
  scanUrl,
  validateDestination,
  type RejectReason,
  type SafetyState,
} from '@clipal/safety';
import { generateSlug } from './slug';

export interface CreateLinkInput {
  destination: string;
  ownerId: string | null;
  creatorIp: string | null;
  creatorUserAgent: string | null;
}

export type CreateLinkResult =
  | {
      ok: true;
      id: string;
      code: string;
      /** flagged as a possible trademark lookalike; live, but queued for review. */
      flaggedForReview: boolean;
      safetyState: SafetyState;
    }
  | {
      ok: false;
      reason: RejectReason | 'blocked' | 'malicious' | 'collision';
      message: string;
    };

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The full submission-time pipeline (§9 slug gen + §14.1 safety):
 *   validate syntax/SSRF → blocklist → Google Safe Browsing → insert with
 *   collision retry. Hard-rejects malicious/blocked/private; brand lookalikes
 *   are created live but flagged (audit_log) for admin review (non-blocking,
 *   §14.13). The redirect path is never touched here.
 */
export async function createLink(input: CreateLinkInput): Promise<CreateLinkResult> {
  const syntax = validateDestination(input.destination);
  if (!syntax.ok) return { ok: false, reason: syntax.reason, message: syntax.message };

  const { url, host, etld1, sld } = syntax.value;

  // Unified blocklist (§14.1, §14.13): exact eTLD+1 domains + substring keywords.
  // 'reject' hard-blocks; 'flag' lets the link through but queues it for review.
  const block = await checkBlocklist(host, etld1, sld);
  if (block.action === 'reject') {
    return {
      ok: false,
      reason: 'blocked',
      message: 'That destination is blocked on clip.al.',
    };
  }
  const flaggedForReview = block.action === 'flag';

  // Google Safe Browsing. Hard-reject anything it flags.
  const scan = await scanUrl(url);
  if (scan.state === 'malicious') {
    return {
      ok: false,
      reason: 'malicious',
      message: 'That destination was flagged as unsafe and can’t be shortened.',
    };
  }

  const uaHash = input.creatorUserAgent ? sha256(input.creatorUserAgent) : null;

  // Insert with collision retry (§9). nanoid space makes this near-certain on the
  // first try even at a billion links, but we handle it.
  for (let attempt = 0; attempt <= SLUG_MAX_RETRIES; attempt++) {
    const code = generateSlug();
    // Generated slug colliding with a reserved word is astronomically unlikely,
    // but the check is cheap insurance.
    if (await isReservedSlug(code)) continue;

    const inserted = await db
      .insert(links)
      .values({
        code,
        destinationUrl: url,
        ownerId: input.ownerId,
        creatorIp: input.creatorIp,
        creatorUaHash: uaHash,
        safetyState: scan.state,
        safetyThreats: scan.threats.length > 0 ? scan.threats : null,
        safetyCheckedAt: scan.state === 'unchecked' ? null : new Date(),
        interstitialRequired: true, // Phase 1: always (paid skip is Phase 2)
      })
      .onConflictDoNothing({ target: links.code })
      .returning({ id: links.id, code: links.code });

    const row = inserted[0];
    if (!row) continue; // code collided — try a new one

    if (flaggedForReview) {
      await recordAudit(db, {
        actorId: null, // system
        action: 'link.flagged_brand',
        targetType: 'link',
        targetId: row.id,
        metadata: {
          code: row.code,
          etld1,
          destination: url,
          ...(block.action === 'flag' ? { matched: block.value } : {}),
        },
      });
    }

    return {
      ok: true,
      id: row.id,
      code: row.code,
      flaggedForReview,
      safetyState: scan.state,
    };
  }

  return {
    ok: false,
    reason: 'collision',
    message: 'Couldn’t allocate a short code — please try again.',
  };
}
