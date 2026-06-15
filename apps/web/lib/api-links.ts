import 'server-only';
import { getPublicBaseUrl } from '@clipal/config';
import { and, db, eq, schema } from '@clipal/db';

/**
 * Shared helpers for the `/api/v1/links/*` handlers: ownership-scoped lookup by
 * code and the canonical JSON serialization of a link row. Centralized so the
 * public shape never diverges between list / get / create / update responses.
 */

/** The public JSON representation of a link (spec §5). Never leaks internal IPs/hashes. */
export interface ApiLink {
  code: string;
  shortUrl: string;
  destinationUrl: string;
  status: schema.Link['status'];
  routingMode: schema.Link['routingMode'];
  customSlug: boolean;
  passwordProtected: boolean;
  expiresAt: string | null;
  maxClicks: number | null;
  clicksTotal: number;
  lastClickAt: string | null;
  campaignId: string | null;
  safetyState: schema.Link['safetyState'];
  createdAt: string;
  updatedAt: string;
}

/** Serialize a DB link row into its public API shape. */
export function serializeLink(link: schema.Link): ApiLink {
  return {
    code: link.code,
    shortUrl: `${getPublicBaseUrl()}/${link.code}`,
    destinationUrl: link.destinationUrl,
    status: link.status,
    routingMode: link.routingMode,
    customSlug: link.customSlug,
    passwordProtected: link.passwordHash !== null,
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    maxClicks: link.maxClicks,
    clicksTotal: link.clicksTotal,
    lastClickAt: link.lastClickAt ? link.lastClickAt.toISOString() : null,
    campaignId: link.campaignId,
    safetyState: link.safetyState,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}

/**
 * Fetch a link by `code` ONLY when it belongs to `ownerId`. Returns null both
 * when the code is unknown and when it belongs to another account — so callers
 * uniformly answer 404 and never leak the existence of someone else's link.
 */
export async function findOwnedLink(
  code: string,
  ownerId: string,
): Promise<schema.Link | null> {
  const [link] = await db
    .select()
    .from(schema.links)
    .where(and(eq(schema.links.code, code), eq(schema.links.ownerId, ownerId)))
    .limit(1);
  return link ?? null;
}
