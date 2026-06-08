import {
  CUSTOM_SLUG_MAX_LENGTH,
  CUSTOM_SLUG_MIN_LENGTH,
  CUSTOM_SLUG_REGEX,
  SLUG_ALPHABET,
  SLUG_LENGTH,
} from '@clipal/config/constants';
import { customAlphabet } from 'nanoid';

const nano = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);

/** Generate a 7-char base62 slug. ~3.5e12 space; collisions handled on insert. */
export function generateSlug(): string {
  return nano();
}

export type CustomSlugResult = { ok: true; value: string } | { ok: false; reason: string };

/**
 * Validate a user-chosen custom back-half — the synchronous, format-only gate.
 * Reserved-word and uniqueness checks are async (Redis/Postgres) and happen in
 * the caller. Case is preserved (codes resolve case-sensitively).
 */
export function validateCustomSlug(raw: string): CustomSlugResult {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, reason: 'Enter a back-half.' };
  if (value.length < CUSTOM_SLUG_MIN_LENGTH || value.length > CUSTOM_SLUG_MAX_LENGTH) {
    return {
      ok: false,
      reason: `Back-half must be ${CUSTOM_SLUG_MIN_LENGTH}–${CUSTOM_SLUG_MAX_LENGTH} characters.`,
    };
  }
  if (!CUSTOM_SLUG_REGEX.test(value)) {
    return {
      ok: false,
      reason:
        'Use letters, numbers, hyphens or underscores, starting and ending with a letter or number.',
    };
  }
  return { ok: true, value };
}
