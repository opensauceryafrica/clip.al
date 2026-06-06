import { SLUG_ALPHABET, SLUG_LENGTH } from '@clipal/config/constants';
import { customAlphabet } from 'nanoid';

const nano = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);

/** Generate a 7-char base62 slug. ~3.5e12 space; collisions handled on insert. */
export function generateSlug(): string {
  return nano();
}
