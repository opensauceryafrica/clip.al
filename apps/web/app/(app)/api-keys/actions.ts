'use server';

import { planLimits, resolvePlan } from '@clipal/billing';
import { and, db, eq, isNull, recordAudit, schema } from '@clipal/db';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  API_SCOPES,
  countActiveApiKeys,
  generateApiKey,
  isApiScope,
  type ApiScope,
  type KeyEnv,
} from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { getClientIp, getUserAgent } from '@/lib/request';

/** Result of creating a key — the plaintext is included EXACTLY once, here. */
export interface CreateKeyState {
  ok?: boolean;
  error?: string;
  /** Full secret to show in the copy-once panel. Never persisted/returned again. */
  plaintext?: string;
  prefix?: string;
  name?: string;
}

async function auditContext(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  return { ip: getClientIp(h), userAgent: getUserAgent(h) };
}

function parseScopes(formData: FormData): ApiScope[] {
  const raw = formData.getAll('scopes').map(String);
  return API_SCOPES.filter((s) => raw.includes(s));
}

function parseEnv(formData: FormData): KeyEnv {
  return String(formData.get('env') ?? 'live') === 'test' ? 'test' : 'live';
}

/**
 * Mint a new API key for the current user. Enforces the plan API budget gate (a
 * plan with `apiRequestsPerMonth <= 0` has no API access) and a soft cap on the
 * number of live keys. The plaintext is returned ONCE in the action state and
 * never stored — only `prefix` + `keyHash` are persisted.
 */
export async function createApiKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  const user = await requireUser();

  const name = String(formData.get('name') ?? '').trim().slice(0, 80);
  if (!name) return { error: 'Give the key a name so you can recognise it later.' };

  const scopes = parseScopes(formData);
  if (scopes.length === 0) return { error: 'Select at least one scope.', name };

  const plan = await resolvePlan(user.id);
  if (planLimits(plan).apiRequestsPerMonth <= 0) {
    return { error: 'API access is not available on your plan. Upgrade to use API keys.', name };
  }

  // Soft cap on live keys to keep the surface manageable (10 active keys/user).
  const MAX_ACTIVE_KEYS = 10;
  if ((await countActiveApiKeys(user.id)) >= MAX_ACTIVE_KEYS) {
    return {
      error: `You already have ${MAX_ACTIVE_KEYS} active keys. Revoke one before creating another.`,
      name,
    };
  }

  const envName = parseEnv(formData);
  const { plaintext, prefix, keyHash } = generateApiKey(envName);

  const [row] = await db
    .insert(schema.apiKeys)
    .values({ userId: user.id, name, prefix, keyHash, scopes })
    .returning({ id: schema.apiKeys.id });

  await recordAudit(db, {
    actorId: user.id,
    action: 'api_key.create',
    targetType: 'api_key',
    targetId: row?.id ?? prefix,
    metadata: { name, prefix, scopes, env: envName },
    ...(await auditContext()),
  });

  revalidatePath('/api-keys');
  return { ok: true, plaintext, prefix, name };
}

/** Revoke a key (irreversible). Only the owner may revoke their own keys. */
export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const keyId = String(formData.get('keyId') ?? '');
  if (!keyId) return;

  const [updated] = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.apiKeys.id, keyId),
        eq(schema.apiKeys.userId, user.id),
        isNull(schema.apiKeys.revokedAt),
      ),
    )
    .returning({ prefix: schema.apiKeys.prefix });
  if (!updated) return;

  await recordAudit(db, {
    actorId: user.id,
    action: 'api_key.revoke',
    targetType: 'api_key',
    targetId: keyId,
    metadata: { prefix: updated.prefix },
    ...(await auditContext()),
  });
  revalidatePath('/api-keys');
}

/**
 * Rotate a key: revoke the existing one and mint a replacement with the SAME
 * name + scopes + env. The new plaintext is returned ONCE in the action state.
 */
export async function rotateApiKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  const user = await requireUser();
  const keyId = String(formData.get('keyId') ?? '');
  if (!keyId) return { error: 'Missing key.' };

  const [existing] = await db
    .select({
      name: schema.apiKeys.name,
      scopes: schema.apiKeys.scopes,
      prefix: schema.apiKeys.prefix,
      revokedAt: schema.apiKeys.revokedAt,
    })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.userId, user.id)))
    .limit(1);
  if (!existing) return { error: 'Key not found.' };
  if (existing.revokedAt) return { error: 'This key is already revoked.' };

  // Derive the env from the old prefix (`clpl_live_…` / `clpl_test_…`).
  const envName: KeyEnv = existing.prefix.startsWith('clpl_test_') ? 'test' : 'live';
  const scopes = existing.scopes.filter(isApiScope);
  const { plaintext, prefix, keyHash } = generateApiKey(envName);

  await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(schema.apiKeys.id, keyId));

  const [row] = await db
    .insert(schema.apiKeys)
    .values({ userId: user.id, name: existing.name, prefix, keyHash, scopes })
    .returning({ id: schema.apiKeys.id });

  await recordAudit(db, {
    actorId: user.id,
    action: 'api_key.rotate',
    targetType: 'api_key',
    targetId: row?.id ?? prefix,
    metadata: { name: existing.name, oldKeyId: keyId, oldPrefix: existing.prefix, prefix, scopes, env: envName },
    ...(await auditContext()),
  });

  revalidatePath('/api-keys');
  return { ok: true, plaintext, prefix, name: existing.name };
}
