import { DEFAULT_PROFANITY_TERMS } from '@clipal/config/constants';

/**
 * Soft profanity gate for user-chosen custom back-halves (§8). Lowercases the
 * candidate and substring-matches against the config baseline wordlist; returns
 * true if any term appears. Pure + synchronous.
 *
 * TODO(@owner): the `app_settings.profanity_wordlist` DB key OVERRIDES this
 * baseline — wire an async, DB-aware variant once that override surface lands.
 */
export function containsProfanity(slug: string): boolean {
  const s = slug.toLowerCase();
  return DEFAULT_PROFANITY_TERMS.some((term) => s.includes(term));
}
