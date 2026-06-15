/**
 * Link-password hashing — the same Argon2id parameters and lazy native import as
 * the auth-code hashing in `./code`. Used by power links (§8) to protect a
 * destination behind a passphrase. Verification is constant-time inside the
 * library; never roll your own compare.
 *
 * Argon2id is @node-rs/argon2's default algorithm (its `Algorithm` enum is an
 * ambient const enum that can't be imported under verbatimModuleSyntax, so we
 * rely on the default rather than naming it).
 */
const ARGON2_OPTIONS = {
  timeCost: 3,
  memoryCost: 65_536, // KiB = 64 MiB
  parallelism: 4,
} as const;

// @node-rs/argon2 is a native (.node) module. Imported LAZILY so merely importing
// @clipal/auth on a public page doesn't pull the native binary into that route's
// module graph — only the hash/verify call sites load it.
async function argon2() {
  return import('@node-rs/argon2');
}

/** Hash a link password with Argon2id. */
export async function hashPassword(password: string): Promise<string> {
  const { hash } = await argon2();
  return hash(password, ARGON2_OPTIONS);
}

/** Constant-time verify of a candidate password against its stored hash. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    const { verify } = await argon2();
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
