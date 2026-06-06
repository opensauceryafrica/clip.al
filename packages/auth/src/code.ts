import { randomInt } from 'node:crypto';
import { AUTH_CODE_LENGTH } from '@clipal/config/constants';

/**
 * Argon2id parameters per §8 hardening (time=3, memory=64MiB, parallelism=4).
 * Argon2id is @node-rs/argon2's default algorithm (its `Algorithm` enum is an
 * ambient const enum that can't be imported under verbatimModuleSyntax, so we
 * rely on the default rather than naming it).
 * Verification is constant-time inside the library — never roll your own compare.
 */
const ARGON2_OPTIONS = {
  timeCost: 3,
  memoryCost: 65_536, // KiB = 64 MiB
  parallelism: 4,
} as const;

// @node-rs/argon2 is a native (.node) module. We import it LAZILY so that merely
// importing @clipal/auth (e.g. for session validation on a public page) doesn't
// pull the native binary into that route's module graph — only the sign-in/verify
// flow that actually hashes/verifies loads it.
async function argon2() {
  return import('@node-rs/argon2');
}

/** Cryptographically-random zero-padded 6-digit code. */
export function generateCode(): string {
  const upperBound = 10 ** AUTH_CODE_LENGTH;
  return randomInt(0, upperBound)
    .toString()
    .padStart(AUTH_CODE_LENGTH, '0');
}

export async function hashCode(code: string): Promise<string> {
  const { hash } = await argon2();
  return hash(code, ARGON2_OPTIONS);
}

export async function verifyCode(codeHash: string, code: string): Promise<boolean> {
  try {
    const { verify } = await argon2();
    return await verify(codeHash, code);
  } catch {
    return false;
  }
}
