import 'server-only';
import { isProd } from '@clipal/config';
import { and, db, gt, inArray, isNull, links } from '@clipal/db';
import { cookies } from 'next/headers';

/**
 * Anonymous-link claiming (§13). When an anon user shortens, the link's UUID is
 * appended to an httpOnly 24h cookie. After they sign in, those links are
 * assigned to the new account. The UUID itself is the capability — only the
 * browser that created the link knows it — so no extra signing is needed, and
 * forging is infeasible (UUIDs aren't guessable). We still require owner_id IS
 * NULL and created within 24h at claim time.
 */
const CLAIM_COOKIE = 'clipal_claim';
const MAX_IDS = 20;
const TTL_SECONDS = 24 * 60 * 60;

function parseIds(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const arr: unknown = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function addClaimableLink(id: string): Promise<void> {
  const store = await cookies();
  const current = parseIds(store.get(CLAIM_COOKIE)?.value);
  if (!current.includes(id)) current.unshift(id);
  store.set(CLAIM_COOKIE, JSON.stringify(current.slice(0, MAX_IDS)), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isProd,
    maxAge: TTL_SECONDS,
  });
}

/** Read + clear the claim cookie and assign the links to the user. */
export async function claimPendingLinks(userId: string): Promise<number> {
  const store = await cookies();
  const ids = parseIds(store.get(CLAIM_COOKIE)?.value);
  store.delete(CLAIM_COOKIE);
  if (ids.length === 0) return 0;

  const cutoff = new Date(Date.now() - TTL_SECONDS * 1000);
  const claimed = await db
    .update(links)
    .set({ ownerId: userId })
    .where(and(inArray(links.id, ids), isNull(links.ownerId), gt(links.createdAt, cutoff)))
    .returning({ id: links.id });
  return claimed.length;
}
