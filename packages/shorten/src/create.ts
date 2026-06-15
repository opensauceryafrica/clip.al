import { createHash } from 'node:crypto';
import { isReservedSlug } from '@clipal/cache';
import { CUSTOM_SLUG_REGEX, SLUG_MAX_RETRIES } from '@clipal/config/constants';
import { db, linkDestinations, links, recordAudit } from '@clipal/db';
import type { DestinationMatch } from '@clipal/db';
import {
  checkBlocklist,
  containsProfanity,
  scanUrl,
  validateDestination,
  type RejectReason,
  type SafetyState,
} from '@clipal/safety';
import { generateSlug } from './slug';

export type RoutingMode = 'single' | 'geo' | 'device' | 'ab';

/** A non-default routing destination to persist alongside the link. */
export interface PowerRule {
  match: DestinationMatch;
  url: string;
  order: number;
}

/**
 * Optional power-link configuration (§8). Plan-gating is the CALLER's job (the
 * server action calls `requireFeature` per feature) — `createLink` trusts these
 * fields and only enforces slug/URL SAFETY, not entitlement.
 */
export interface PowerLinkConfig {
  /** When set, the link is created with this exact code (custom back-half). */
  customSlug?: string;
  /** argon2id hash; presence => password-protected. */
  passwordHash?: string;
  /** Expiry instant. */
  expiresAt?: Date;
  /** Click cap. */
  maxClicks?: number;
  /** Routing strategy; defaults to 'single'. */
  routingMode?: RoutingMode;
  /** Destination rows for non-'single' routing (ignored when 'single'). */
  rules?: PowerRule[];
  /** Owning campaign (A/B grouping). */
  campaignId?: string;
}

export interface CreateLinkInput {
  destination: string;
  ownerId: string | null;
  creatorIp: string | null;
  creatorUserAgent: string | null;
  /** Optional power-link config. Absent => a plain auto-slug single link. */
  power?: PowerLinkConfig;
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
      reason: RejectReason | 'blocked' | 'malicious' | 'collision' | 'slug_taken' | 'slug_invalid';
      message: string;
    };

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The full submission-time pipeline (§9 slug gen + §14.1 safety):
 *   validate syntax/SSRF → blocklist → Google Safe Browsing → insert with
 *   collision retry (auto slug) OR an exact-code insert (custom slug). Hard-rejects
 *   malicious/blocked/private; brand lookalikes are created live but flagged
 *   (audit_log) for admin review (non-blocking, §14.13).
 *
 * When `power` is supplied: a custom slug is format/reserved/profanity-checked and
 * inserted with ON CONFLICT → `slug_taken`; power columns are written; and for
 * non-'single' routing the `link_destinations` rows are inserted in the SAME
 * transaction as the link. The redirect path is never touched here.
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
  const power = input.power;
  const routingMode: RoutingMode = power?.routingMode ?? 'single';
  const rules = routingMode !== 'single' ? (power?.rules ?? []) : [];

  // Shared power columns written on every insert path below.
  const powerValues = {
    passwordHash: power?.passwordHash ?? null,
    expiresAt: power?.expiresAt ?? null,
    maxClicks: power?.maxClicks ?? null,
    routingMode,
    campaignId: power?.campaignId ?? null,
  } as const;

  // Persist the link + (when routed) its destination rows atomically, then run
  // the brand-flag audit. Returns null on a code collision/conflict.
  async function persist(
    code: string,
    customSlug: boolean,
  ): Promise<{ id: string; code: string } | null> {
    return db.transaction(async (tx) => {
      const inserted = await tx
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
          customSlug,
          ...powerValues,
        })
        .onConflictDoNothing({ target: links.code })
        .returning({ id: links.id, code: links.code });

      const row = inserted[0];
      if (!row) return null; // code collided — caller decides retry vs. slug_taken

      if (rules.length > 0) {
        await tx.insert(linkDestinations).values(
          rules.map((r) => ({
            linkId: row.id,
            match: r.match,
            destinationUrl: r.url,
            order: r.order,
          })),
        );
      }
      return row;
    });
  }

  async function auditFlag(id: string, code: string): Promise<void> {
    if (!flaggedForReview) return;
    await recordAudit(db, {
      actorId: null, // system
      action: 'link.flagged_brand',
      targetType: 'link',
      targetId: id,
      metadata: {
        code,
        etld1,
        destination: url,
        ...(block.action === 'flag' ? { matched: block.value } : {}),
      },
    });
  }

  // ── Custom-slug path: exact code, single attempt, conflict => slug_taken ────
  if (power?.customSlug) {
    const code = power.customSlug.trim();
    if (!CUSTOM_SLUG_REGEX.test(code)) {
      return {
        ok: false,
        reason: 'slug_invalid',
        message:
          'Use letters, numbers, hyphens or underscores, starting and ending with a letter or number.',
      };
    }
    if (await isReservedSlug(code)) {
      return { ok: false, reason: 'slug_taken', message: 'That back-half is reserved.' };
    }
    if (containsProfanity(code)) {
      return { ok: false, reason: 'slug_invalid', message: 'That back-half isn’t allowed.' };
    }

    let row: { id: string; code: string } | null;
    try {
      row = await persist(code, true);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return { ok: false, reason: 'slug_taken', message: 'That back-half is already taken.' };
      }
      throw err;
    }
    if (!row) {
      return { ok: false, reason: 'slug_taken', message: 'That back-half is already taken.' };
    }
    await auditFlag(row.id, row.code);
    return { ok: true, id: row.id, code: row.code, flaggedForReview, safetyState: scan.state };
  }

  // ── Auto-slug path: collision retry (§9). ──────────────────────────────────
  for (let attempt = 0; attempt <= SLUG_MAX_RETRIES; attempt++) {
    const code = generateSlug();
    // Generated slug colliding with a reserved word is astronomically unlikely,
    // but the check is cheap insurance.
    if (await isReservedSlug(code)) continue;

    const row = await persist(code, false);
    if (!row) continue; // code collided — try a new one

    await auditFlag(row.id, row.code);
    return { ok: true, id: row.id, code: row.code, flaggedForReview, safetyState: scan.state };
  }

  return {
    ok: false,
    reason: 'collision',
    message: 'Couldn’t allocate a short code — please try again.',
  };
}
