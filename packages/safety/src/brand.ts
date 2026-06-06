import { getBrandTerms, type BrandTerm, type BrandTermPolicy } from '@clipal/cache';

export type { BrandTermPolicy } from '@clipal/cache';

export type BrandMatch =
  | { matched: false }
  | { matched: true; term: string; policy: BrandTermPolicy };

/**
 * Trademark-lookalike heuristic (§14.13), pure and unit-testable.
 *
 * A brand term matches when it appears in the host but the registrable domain's
 * second-level label isn't exactly that term — i.e. it's NOT the genuine brand
 * domain. e.g. host "paypal-login.com" (sld "paypal-login") matches "paypal";
 * the real "paypal.com" (sld "paypal") and "help.netflix.com" (sld "netflix")
 * do not.
 *
 * A 'reject' match wins immediately (hard block). Otherwise the first 'flag'
 * match is returned — a soft, non-blocking review flag (the link still goes
 * live). Seed terms are all 'flag'; 'reject' is an explicit admin opt-in.
 */
export function matchBrandTerm(
  host: string,
  sld: string,
  terms: readonly BrandTerm[],
): BrandMatch {
  let flagged: { term: string; policy: BrandTermPolicy } | null = null;
  for (const { term, policy } of terms) {
    const t = term.toLowerCase();
    if (host.includes(t) && sld !== t) {
      if (policy === 'reject') return { matched: true, term: t, policy: 'reject' };
      flagged ??= { term: t, policy: 'flag' };
    }
  }
  return flagged ? { matched: true, ...flagged } : { matched: false };
}

/**
 * Async wrapper reading the Redis-cached brand terms (rebuilt from Postgres at
 * boot and on every admin mutation, same pattern as the domain blocklist).
 * Fails open — brand flagging is a non-blocking review signal, so a Redis blip
 * must never break the shorten path.
 */
export async function checkBrandTerms(host: string, sld: string): Promise<BrandMatch> {
  let terms: BrandTerm[];
  try {
    terms = await getBrandTerms();
  } catch {
    return { matched: false };
  }
  return matchBrandTerm(host, sld, terms);
}
