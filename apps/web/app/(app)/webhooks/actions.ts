'use server';

import { planLimits, resolvePlan } from '@clipal/billing';
import {
  and,
  count,
  db,
  eq,
  recordAudit,
  webhookDeliveries,
  webhooks,
} from '@clipal/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormActionState } from '@/lib/action-state';
import { requireUser } from '@/lib/auth';
import {
  buildEnvelope,
  generateWebhookSecret,
  isWebhookEventType,
  type WebhookEventType,
} from '@/lib/webhooks';

const URL_MAX = 2048;

/** State returned by create — carries the one-time secret on success. */
export interface WebhookCreateState extends FormActionState {
  /** Plaintext signing secret, shown exactly once right after creation. */
  secret?: string;
}

/** Parse + validate the `events` checkbox values into the typed union. */
function readEvents(formData: FormData): WebhookEventType[] {
  const raw = formData.getAll('events').map((v) => String(v));
  return raw.filter(isWebhookEventType);
}

/** Reject anything that isn't a plain https(s) URL we can POST to. */
function validateUrl(value: string): string | null {
  if (!value) return 'Enter a delivery URL.';
  if (value.length > URL_MAX) return `URL must be ${URL_MAX} characters or fewer.`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'Enter a valid URL.';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'URL must be an http(s) endpoint.';
  }
  return null;
}

/** Load a webhook the current user owns, or null. */
async function ownedWebhook(webhookId: string, userId: string) {
  if (!webhookId) return null;
  const [row] = await db
    .select({ id: webhooks.id, url: webhooks.url, secret: webhooks.secret })
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Create a webhook endpoint. Plan-gated on the `webhooks` COUNT limit
 * (planLimits.webhooks; 0 = unavailable). A fresh signing secret is generated
 * server-side and returned ONCE — it is never shown again. requireUser +
 * recordAudit + revalidate.
 */
export async function createWebhookAction(
  _prev: WebhookCreateState,
  formData: FormData,
): Promise<WebhookCreateState> {
  const user = await requireUser();
  const url = String(formData.get('url') ?? '').trim();
  const events = readEvents(formData);

  const urlError = validateUrl(url);
  if (urlError) return { error: urlError };
  if (events.length === 0) return { error: 'Select at least one event to subscribe to.' };

  // Plan COUNT cap. 0 => webhooks unavailable on this plan entirely.
  const plan = await resolvePlan(user.id);
  const limit = planLimits(plan).webhooks;
  if (limit === 0) {
    return { error: 'Your plan does not include webhooks. Upgrade to add endpoints.' };
  }
  const [row] = await db
    .select({ c: count() })
    .from(webhooks)
    .where(eq(webhooks.userId, user.id));
  const current = row?.c ?? 0;
  if (current >= limit) {
    return {
      error: `You have reached your plan limit of ${limit} webhook${limit === 1 ? '' : 's'}.`,
    };
  }

  const secret = generateWebhookSecret();
  const [created] = await db
    .insert(webhooks)
    .values({ userId: user.id, url, secret, events })
    .returning({ id: webhooks.id });

  if (created) {
    await recordAudit(db, {
      actorId: user.id,
      action: 'webhook.created',
      targetType: 'webhook',
      targetId: created.id,
      metadata: { url, events },
    });
  }

  revalidatePath('/webhooks');
  return { ok: true, secret };
}

/**
 * Edit a webhook's URL and subscribed events. The signing secret is immutable
 * here (rotate via a separate action). Own-the-webhook guard.
 */
export async function updateWebhookAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const webhookId = String(formData.get('webhookId') ?? '');
  const url = String(formData.get('url') ?? '').trim();
  const events = readEvents(formData);

  const webhook = await ownedWebhook(webhookId, user.id);
  if (!webhook) return { error: 'Webhook not found.' };

  const urlError = validateUrl(url);
  if (urlError) return { error: urlError };
  if (events.length === 0) return { error: 'Select at least one event to subscribe to.' };

  await db
    .update(webhooks)
    .set({ url, events })
    .where(eq(webhooks.id, webhookId));

  await recordAudit(db, {
    actorId: user.id,
    action: 'webhook.updated',
    targetType: 'webhook',
    targetId: webhookId,
    metadata: { url, events },
  });

  revalidatePath('/webhooks');
  revalidatePath(`/webhooks/${webhookId}`);
  return { ok: true };
}

/**
 * Toggle a webhook's active flag. Re-enabling resets the failure count so a
 * previously auto-disabled endpoint gets a clean run. Own-the-webhook guard.
 */
export async function toggleWebhookAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const webhookId = String(formData.get('webhookId') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';

  const webhook = await ownedWebhook(webhookId, user.id);
  if (!webhook) redirect('/webhooks');

  await db
    .update(webhooks)
    .set(active ? { active: true, failureCount: 0 } : { active: false })
    .where(eq(webhooks.id, webhookId));

  await recordAudit(db, {
    actorId: user.id,
    action: active ? 'webhook.enabled' : 'webhook.disabled',
    targetType: 'webhook',
    targetId: webhookId,
  });

  revalidatePath('/webhooks');
  revalidatePath(`/webhooks/${webhookId}`);
}

/** Delete a webhook (cascades its deliveries via FK). Own-the-webhook guard. */
export async function deleteWebhookAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const webhookId = String(formData.get('webhookId') ?? '');

  const webhook = await ownedWebhook(webhookId, user.id);
  if (!webhook) redirect('/webhooks');

  await db.delete(webhooks).where(eq(webhooks.id, webhookId));

  await recordAudit(db, {
    actorId: user.id,
    action: 'webhook.deleted',
    targetType: 'webhook',
    targetId: webhookId,
    metadata: { url: webhook.url },
  });

  revalidatePath('/webhooks');
  redirect('/webhooks');
}

/**
 * Queue a synthetic `webhook.test` delivery so the user can verify their
 * endpoint receives + validates signatures. Enqueues a pending delivery row the
 * worker will pick up like any other. Own-the-webhook guard.
 */
export async function testWebhookAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const webhookId = String(formData.get('webhookId') ?? '');

  const webhook = await ownedWebhook(webhookId, user.id);
  if (!webhook) redirect('/webhooks');

  // A real event type so the payload shape is representative; the data marks it
  // as a manual test ping.
  const envelope = buildEnvelope('link.created', {
    test: true,
    message: 'This is a test delivery from clip.al.',
  });

  await db.insert(webhookDeliveries).values({
    webhookId,
    eventType: 'link.created',
    payload: envelope as unknown,
    nextRetryAt: new Date(),
  });

  await recordAudit(db, {
    actorId: user.id,
    action: 'webhook.test',
    targetType: 'webhook',
    targetId: webhookId,
  });

  revalidatePath(`/webhooks/${webhookId}`);
  redirect(`/webhooks/${webhookId}`);
}

/**
 * Replay a past delivery: clone its payload into a fresh pending delivery row so
 * the worker re-POSTs it. Own-the-webhook guard (via the delivery's webhook).
 */
export async function replayDeliveryAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const deliveryId = String(formData.get('deliveryId') ?? '');

  // Join to ensure the delivery belongs to a webhook this user owns.
  const [row] = await db
    .select({
      id: webhookDeliveries.id,
      webhookId: webhookDeliveries.webhookId,
      eventType: webhookDeliveries.eventType,
      payload: webhookDeliveries.payload,
    })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhooks.userId, user.id)))
    .limit(1);

  if (!row) redirect('/webhooks');

  await db.insert(webhookDeliveries).values({
    webhookId: row.webhookId,
    eventType: row.eventType,
    payload: row.payload,
    nextRetryAt: new Date(),
  });

  await recordAudit(db, {
    actorId: user.id,
    action: 'webhook.replay',
    targetType: 'webhook',
    targetId: row.webhookId,
    metadata: { sourceDeliveryId: deliveryId },
  });

  revalidatePath(`/webhooks/${row.webhookId}`);
  redirect(`/webhooks/${row.webhookId}`);
}
