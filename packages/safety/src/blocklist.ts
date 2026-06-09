import { blockedDomainPolicy, getBlockKeywords, type BlockPolicy } from '@clipal/cache';

export type { BlockPolicy } from '@clipal/cache';

export type KeywordMatch =
  | { matched: false }
  | { matched: true; value: string; policy: BlockPolicy };

/**
 * Substring (keyword) match for the unified blocklist (§14.13), pure and
 * unit-testable. A keyword matches when it appears in the host but the
 * registrable domain's second-level label isn't exactly it — i.e. NOT the
 * genuine site. e.g. host "paypal-login.com" (sld "paypal-login") matches
 * "paypal"; the real "paypal.com" / "help.netflix.com" do not. A 'reject' match
 * wins over a 'flag' match.
 */
export function matchKeyword(
  host: string,
  sld: string,
  keywords: readonly { value: string; policy: BlockPolicy }[],
): KeywordMatch {
  let flagged: { value: string; policy: BlockPolicy } | null = null;
  for (const { value, policy } of keywords) {
    const k = value.toLowerCase();
    if (host.includes(k) && sld !== k) {
      if (policy === 'reject') return { matched: true, value: k, policy: 'reject' };
      flagged ??= { value: k, policy: 'flag' };
    }
  }
  return flagged ? { matched: true, ...flagged } : { matched: false };
}

export type BlockDecision =
  | { action: 'allow' }
  | { action: 'flag'; value: string }
  | { action: 'reject'; value: string };

/**
 * Evaluate a destination against the unified blocklist: exact eTLD+1 (domain
 * entries) and substring-of-host (keyword entries). 'reject' wins over 'flag';
 * any flag (from either match type) yields a soft, non-blocking review flag.
 * Fails open — a Redis blip must never break the shorten path.
 */
export async function checkBlocklist(
  host: string,
  etld1: string,
  sld: string,
): Promise<BlockDecision> {
  const domainPolicy = await blockedDomainPolicy(etld1).catch(() => null);
  if (domainPolicy === 'reject') return { action: 'reject', value: etld1 };

  let keyword: KeywordMatch = { matched: false };
  try {
    keyword = matchKeyword(host, sld, await getBlockKeywords());
  } catch {
    /* fail open */
  }
  if (keyword.matched && keyword.policy === 'reject') {
    return { action: 'reject', value: keyword.value };
  }
  if (domainPolicy === 'flag') return { action: 'flag', value: etld1 };
  if (keyword.matched) return { action: 'flag', value: keyword.value };
  return { action: 'allow' };
}
