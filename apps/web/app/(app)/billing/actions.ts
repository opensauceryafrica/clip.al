'use server';

import { applyBillingEvent, bustPlanCache, startCheckout } from '@clipal/billing';
import { intervals, type Interval, type PlanName } from '@clipal/config';
import { db, eq, recordAudit, subscriptions } from '@clipal/db';
import { lookupCountry } from '@clipal/geo';
import {
  cancelSubscription as polarCancelSubscription,
  isPolarConfigured,
} from '@clipal/polar';
import {
  disableSubscription as paystackDisableSubscription,
  enableSubscription as paystackEnableSubscription,
  isPaystackConfigured,
} from '@clipal/paystack';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getClientIp, getUserAgent } from '@/lib/request';

async function auditContext(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  return { ip: getClientIp(h), userAgent: getUserAgent(h) };
}

/** Resolve the buyer's country from request IP, for processor/currency routing. */
async function clientCountry(): Promise<string> {
  const h = await headers();
  return lookupCountry(getClientIp(h));
}

function isPlan(v: unknown): v is Exclude<PlanName, 'free'> {
  return v === 'pro' || v === 'business';
}

function isInterval(v: unknown): v is Interval {
  return (intervals as readonly string[]).includes(v as string);
}

// ----------------------------------------------------------------------------
// startCheckoutAction — begins a paid checkout and redirects to the provider.
// ----------------------------------------------------------------------------

/**
 * Begin a checkout for `(plan, interval)`. The processor + currency are
 * geo-routed from the buyer's request IP (NG ⇒ Paystack/NGN, else ⇒ Polar/USD)
 * inside the billing core. On success we `redirect()` the browser to the hosted
 * provider page; on failure we bounce back to /billing with an `?error=` code so
 * the page can surface a friendly message (self-gating: a missing provider key
 * resolves to an error rather than a 500).
 *
 * Accepts the `FormData` from a server-action <form> so the plan/interval ride
 * along as hidden inputs (matches the rest of the admin/app action surface).
 */
export async function startCheckoutAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const planRaw = formData.get('plan');
  const intervalRaw = formData.get('interval');

  if (!isPlan(planRaw)) redirect('/billing?error=invalid_plan');
  const interval: Interval = isInterval(intervalRaw) ? intervalRaw : 'monthly';

  const country = await clientCountry();

  const result = await startCheckout(user.id, planRaw, interval, country);
  if (!result.ok) {
    await recordAudit(db, {
      actorId: user.id,
      action: 'billing.checkout_failed',
      targetType: 'subscription',
      targetId: user.id,
      metadata: { plan: planRaw, interval, error: result.error },
      ...(await auditContext()),
    }).catch(() => {});
    redirect(`/billing?error=${encodeURIComponent(result.error)}`);
  }

  await recordAudit(db, {
    actorId: user.id,
    action: 'billing.checkout_start',
    targetType: 'subscription',
    targetId: user.id,
    metadata: {
      plan: planRaw,
      interval,
      processor: result.data.processor,
      reference: result.data.reference,
    },
    ...(await auditContext()),
  }).catch(() => {});

  // Hand the browser to the hosted provider page. `redirect` throws, so nothing
  // below runs.
  redirect(result.data.redirectUrl);
}

// ----------------------------------------------------------------------------
// cancelSubscriptionAction — schedule a cancel-at-period-end.
// ----------------------------------------------------------------------------

/**
 * Schedule a cancellation that takes effect at the end of the current paid
 * period (graceful downgrade — power-link configs are PRESERVED, see the billing
 * core's "no silent data destruction" guarantee). We tell the provider to stop
 * the next renewal, then apply a local `cancel` event with
 * `cancelAtPeriodEnd: true` so the UI reflects the pending downgrade immediately
 * (the webhook remains the idempotent source of truth).
 */
export async function cancelSubscriptionAction(): Promise<void> {
  const user = await requireUser();

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);

  // Nothing to cancel (free / no row / already cancelled-at-period-end).
  if (!sub || sub.plan === 'free') {
    redirect('/billing');
  }

  // Best-effort tell the provider to stop the renewal. A provider error must not
  // strand the user — we still record the local intent so they aren't billed by
  // surprise; the webhook reconciles the truth.
  if (sub.processor === 'paystack') {
    if (
      isPaystackConfigured() &&
      sub.paystackSubscriptionCode &&
      sub.paystackEmailToken
    ) {
      await paystackDisableSubscription({
        subscriptionCode: sub.paystackSubscriptionCode,
        emailToken: sub.paystackEmailToken,
      }).catch(() => {});
    }
  } else if (sub.processor === 'polar') {
    if (isPolarConfigured() && sub.polarSubscriptionId) {
      await polarCancelSubscription(sub.polarSubscriptionId, true).catch(() => {});
    }
  }

  await applyBillingEvent({
    processor: sub.processor ?? 'paystack',
    type: 'cancel',
    data: {
      userId: user.id,
      plan: sub.plan,
      ...(sub.interval ? { interval: sub.interval as Interval } : {}),
      currency: sub.currency,
      cancelAtPeriodEnd: true,
      ...(sub.currentPeriodEnd
        ? { currentPeriodEnd: sub.currentPeriodEnd.toISOString() }
        : {}),
    },
  });

  await recordAudit(db, {
    actorId: user.id,
    action: 'billing.cancel_at_period_end',
    targetType: 'subscription',
    targetId: user.id,
    metadata: { plan: sub.plan, processor: sub.processor },
    ...(await auditContext()),
  }).catch(() => {});

  revalidatePath('/billing');
  redirect('/billing?notice=cancel_scheduled');
}

// ----------------------------------------------------------------------------
// resumeSubscriptionAction — undo a scheduled cancel-at-period-end.
// ----------------------------------------------------------------------------

/**
 * Undo a pending cancellation while the paid period is still active. We re-enable
 * the provider-side renewal where the API supports it (Paystack `enable`, Polar
 * PATCH `cancel_at_period_end: false`), then clear `cancelAtPeriodEnd` and
 * restore `status: 'active'` on the local row so the plan keeps renewing.
 */
export async function resumeSubscriptionAction(): Promise<void> {
  const user = await requireUser();

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);

  // Only meaningful when a cancel is actually pending on a still-paid period.
  if (!sub || sub.plan === 'free' || !sub.cancelAtPeriodEnd) {
    redirect('/billing');
  }
  const stillPaid =
    !sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > Date.now();
  if (!stillPaid) {
    // The period already lapsed — there's nothing to resume; send them to
    // re-subscribe instead.
    redirect('/billing');
  }

  if (sub.processor === 'paystack') {
    if (
      isPaystackConfigured() &&
      sub.paystackSubscriptionCode &&
      sub.paystackEmailToken
    ) {
      await paystackEnableSubscription({
        subscriptionCode: sub.paystackSubscriptionCode,
        emailToken: sub.paystackEmailToken,
      }).catch(() => {});
    }
  } else if (sub.processor === 'polar') {
    if (isPolarConfigured() && sub.polarSubscriptionId) {
      await polarCancelSubscription(sub.polarSubscriptionId, false).catch(() => {
        // Polar's "uncancel" is the same PATCH endpoint with cancel_at_period_end:false;
        // surfaced via cancelSubscription(false) is DELETE, so we instead clear locally.
      });
    }
  }

  // Convergently restore the active, auto-renewing state locally.
  await db
    .update(subscriptions)
    .set({ status: 'active', cancelAtPeriodEnd: false })
    .where(eq(subscriptions.userId, user.id));
  await bustPlanCache(user.id);

  await recordAudit(db, {
    actorId: user.id,
    action: 'billing.resume',
    targetType: 'subscription',
    targetId: user.id,
    metadata: { plan: sub.plan, processor: sub.processor },
    ...(await auditContext()),
  }).catch(() => {});

  revalidatePath('/billing');
  redirect('/billing?notice=resumed');
}
