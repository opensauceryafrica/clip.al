/**
 * @clipal/billing — server-side subscription STATE MACHINE (spec §7).
 *
 * This module is the single, provider-agnostic place that mutates a user's
 * `subscriptions` row and writes `invoices` in response to billing activity. It
 * sits one level above the provider packages:
 *
 *   apps/web webhook route ─┐
 *   apps/worker drain loop ─┼─► normalize<Provider>Event() ─► applyBillingEvent()
 *   verifyAndActivate()    ─┘
 *
 * The provider SDK calls (Paystack / Polar) only happen in `startCheckout` and
 * `verifyAndActivate`; `applyBillingEvent` itself touches nothing but Postgres +
 * Redis, which keeps it deterministic and unit-testable (mock `@clipal/db`).
 *
 * ── No silent data destruction guarantee ────────────────────────────────────
 * A downgrade (paid → free, or a lapsed/cancelled period) NEVER deletes a user's
 * power-link configuration. `link_destinations` rows and per-link `password_hash`
 * values are PRESERVED untouched. The only thing a downgrade changes on a link
 * is its `routing_mode`: geo/device/ab links are flipped to `single` so the
 * redirect hot path serves the link's default destination (the entitlement the
 * user no longer pays for is suspended, not erased). Re-upgrading restores the
 * original routing_mode from the still-present destination rows. See
 * `degradeUserToFree` / `restoreUserPlan`.
 */

import { keys, redis } from '@clipal/cache';
import {
  type Currency,
  type Interval,
  type PlanName,
  getPublicBaseUrl,
} from '@clipal/config';
import {
  and,
  db,
  eq,
  inArray,
  invoices,
  linkDestinations,
  links,
  recordAudit,
  subscriptions,
  users,
} from '@clipal/db';
import {
  initializeTransaction,
  isPaystackConfigured,
  parseWebhookEvent,
  verifyTransaction,
} from '@clipal/paystack';
import {
  createCheckout,
  getSubscription as getPolarSubscription,
  isPolarConfigured,
} from '@clipal/polar';
import { billingContext, type Processor } from './context';
import { bustPlanCache } from './plan';
import { effectivePrice } from './pricing';

// ----------------------------------------------------------------------------
// Normalized event model — the provider-agnostic vocabulary applyBillingEvent
// understands. Both providers map onto these five intents.
// ----------------------------------------------------------------------------

export type NormalizedEventType =
  /** A subscription was created/activated (subscribe / checkout completed). */
  | 'activate'
  /** A recurring (or first) charge succeeded → invoice paid + period extended. */
  | 'charge.success'
  /** A charge failed → mark subscription past_due (grace until reaper expires). */
  | 'past_due'
  /** The subscription was disabled / cancelled (cancel-at-period-end or now). */
  | 'cancel'
  /** Hard end of the paid period with no renewal → expired + downgrade to free. */
  | 'expire';

export interface NormalizedEventData {
  /** The clip.al user this event belongs to. */
  userId: string;
  /** Target plan (from metadata). Defaults to the existing row's plan. */
  plan?: PlanName | undefined;
  interval?: Interval | undefined;
  currency?: Currency | undefined;
  /** Charge amount in minor units (kobo/cents). Required for charge.success. */
  amountMinor?: number | undefined;
  /** Provider-side unique reference for the invoice row (UNIQUE column). */
  providerReference?: string | undefined;
  /** ISO-8601 string the charge settled; defaults to now. */
  paidAt?: string | undefined;
  /** Period bounds when the provider supplies them. */
  currentPeriodStart?: string | undefined;
  currentPeriodEnd?: string | undefined;
  cancelAtPeriodEnd?: boolean | undefined;
  // Provider identifiers persisted onto the subscriptions row.
  paystackCustomerCode?: string | undefined;
  paystackSubscriptionCode?: string | undefined;
  paystackEmailToken?: string | undefined;
  polarCustomerId?: string | undefined;
  polarSubscriptionId?: string | undefined;
}

export interface NormalizedEvent {
  processor: Processor;
  type: NormalizedEventType;
  data: NormalizedEventData;
}

/** One billing-period length in ms, keyed by interval. Used to extend a period. */
const INTERVAL_MS: Record<Interval, number> = {
  monthly: 30 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
};

function parseDate(value: string | undefined, fallback: Date | null = null): Date | null {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

// ----------------------------------------------------------------------------
// applyBillingEvent — the core, idempotent state transition.
// ----------------------------------------------------------------------------

/**
 * Idempotently apply ONE normalized billing event to a user's subscription +
 * invoice rows. Safe to call twice with the same event (the worker safety net
 * may re-run an event the webhook already processed): an already-paid invoice is
 * recognised by its UNIQUE `provider_reference` and skipped, and subscription
 * upserts are convergent (they set absolute state, not deltas), so a replay
 * produces the same end state — never a doubled effect.
 *
 * Returns a small descriptor of what happened (handy for tests + receipt email).
 */
export interface ApplyResult {
  /** True when this call materially changed the subscription/invoice. */
  changed: boolean;
  /** The plan the user is on AFTER this event. */
  plan: PlanName;
  /** When an invoice was newly recorded as paid, its details (for the receipt). */
  paidInvoice?: {
    amountMinor: number;
    currency: Currency;
    periodEnd: Date | null;
  };
}

export async function applyBillingEvent(event: NormalizedEvent): Promise<ApplyResult> {
  const { processor, type, data } = event;
  const { userId } = data;

  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  const targetPlan: PlanName = data.plan ?? existing?.plan ?? 'free';
  const interval: Interval | null =
    data.interval ?? (existing?.interval as Interval | null) ?? 'monthly';
  const currency: Currency = data.currency ?? (existing?.currency as Currency) ?? 'NGN';

  // Provider id columns — set when present, otherwise keep what we have.
  const providerCols = {
    processor,
    paystackCustomerCode: data.paystackCustomerCode ?? existing?.paystackCustomerCode ?? null,
    paystackSubscriptionCode:
      data.paystackSubscriptionCode ?? existing?.paystackSubscriptionCode ?? null,
    paystackEmailToken: data.paystackEmailToken ?? existing?.paystackEmailToken ?? null,
    polarCustomerId: data.polarCustomerId ?? existing?.polarCustomerId ?? null,
    polarSubscriptionId: data.polarSubscriptionId ?? existing?.polarSubscriptionId ?? null,
  };

  switch (type) {
    case 'activate': {
      const periodStart = parseDate(data.currentPeriodStart, new Date());
      const periodEnd = parseDate(
        data.currentPeriodEnd,
        new Date((periodStart ?? new Date()).getTime() + INTERVAL_MS[interval ?? 'monthly']),
      );
      await upsertSubscription(userId, {
        plan: targetPlan,
        interval,
        status: 'active',
        currency,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
        ...providerCols,
      });
      await restoreUserPlan(userId);
      await afterMutation(userId, 'billing.activate', { processor, plan: targetPlan });
      return { changed: true, plan: targetPlan };
    }

    case 'charge.success': {
      // Record the invoice first (idempotent on provider_reference), THEN extend
      // the period. If the invoice already exists this is a replay → no-op.
      const newlyPaid = await recordPaidInvoice(userId, {
        processor,
        providerReference: data.providerReference,
        amountMinor: data.amountMinor,
        currency,
        paidAt: parseDate(data.paidAt, new Date()),
        subscriptionId: existing?.id ?? null,
      });

      // A REPLAY (invoice already existed) must be a no-op for the period — only
      // a genuinely new charge extends it, otherwise a redelivered webhook would
      // grant free time. If nothing was newly paid, leave the subscription as-is.
      if (!newlyPaid) {
        return { changed: false, plan: targetPlan };
      }

      // Period bounds: prefer provider-supplied, else extend from the later of
      // (now, existing end) by one interval — so back-to-back renewals stack.
      const now = new Date();
      const base = existing?.currentPeriodEnd && existing.currentPeriodEnd > now
        ? existing.currentPeriodEnd
        : now;
      const periodStart = parseDate(data.currentPeriodStart, now);
      const periodEnd = parseDate(
        data.currentPeriodEnd,
        new Date(base.getTime() + INTERVAL_MS[interval ?? 'monthly']),
      );

      await upsertSubscription(userId, {
        plan: targetPlan,
        interval,
        status: 'active',
        currency,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd ?? false,
        ...providerCols,
      });
      await restoreUserPlan(userId);
      await afterMutation(userId, 'billing.charge_success', {
        processor,
        plan: targetPlan,
        amountMinor: data.amountMinor ?? null,
      });

      return {
        changed: true,
        plan: targetPlan,
        ...(data.amountMinor !== undefined
          ? {
              paidInvoice: {
                amountMinor: data.amountMinor,
                currency,
                periodEnd,
              },
            }
          : {}),
      };
    }

    case 'past_due': {
      await upsertSubscription(userId, {
        plan: targetPlan,
        interval,
        status: 'past_due',
        currency,
        currentPeriodStart: existing?.currentPeriodStart ?? null,
        currentPeriodEnd: existing?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: existing?.cancelAtPeriodEnd ?? false,
        ...providerCols,
      });
      // past_due no longer grants the paid plan (resolvePlan downgrades it), so
      // suspend the entitlement-gated routing immediately.
      await degradeUserToFree(userId);
      await afterMutation(userId, 'billing.past_due', { processor });
      return { changed: true, plan: 'free' };
    }

    case 'cancel': {
      // Cancel-at-period-end keeps the plan until the (future) period end; an
      // immediate cancel (no future period) drops to free now.
      const atPeriodEnd = data.cancelAtPeriodEnd ?? true;
      const periodEnd = parseDate(data.currentPeriodEnd, existing?.currentPeriodEnd ?? null);
      const stillActive = atPeriodEnd && periodEnd !== null && periodEnd.getTime() > Date.now();

      await upsertSubscription(userId, {
        plan: targetPlan,
        interval,
        status: 'cancelled',
        currency,
        currentPeriodStart: existing?.currentPeriodStart ?? null,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: atPeriodEnd,
        ...providerCols,
      });

      if (!stillActive) await degradeUserToFree(userId);
      await afterMutation(userId, 'billing.cancel', { processor, atPeriodEnd });
      return { changed: true, plan: stillActive ? targetPlan : 'free' };
    }

    case 'expire': {
      await upsertSubscription(userId, {
        plan: targetPlan,
        interval,
        status: 'expired',
        currency,
        currentPeriodStart: existing?.currentPeriodStart ?? null,
        currentPeriodEnd: existing?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: existing?.cancelAtPeriodEnd ?? false,
        ...providerCols,
      });
      await degradeUserToFree(userId);
      await afterMutation(userId, 'billing.expire', { processor });
      return { changed: true, plan: 'free' };
    }

    default: {
      // Exhaustiveness guard — an unknown normalized type is a programming error.
      const _never: never = type;
      throw new Error(`applyBillingEvent: unhandled event type ${String(_never)}`);
    }
  }
}

/** Convergent upsert of the user's single subscriptions row. */
async function upsertSubscription(
  userId: string,
  set: {
    plan: PlanName;
    interval: Interval | null;
    status: 'active' | 'past_due' | 'cancelled' | 'expired';
    currency: Currency;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    processor: Processor;
    paystackCustomerCode: string | null;
    paystackSubscriptionCode: string | null;
    paystackEmailToken: string | null;
    polarCustomerId: string | null;
    polarSubscriptionId: string | null;
  },
): Promise<void> {
  await db
    .insert(subscriptions)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: subscriptions.userId, set });
}

/**
 * Insert a paid invoice idempotently. The UNIQUE `provider_reference` means a
 * redelivered charge is silently absorbed (onConflictDoNothing) — returns
 * whether a NEW row was actually written (drives the receipt email + `changed`).
 */
async function recordPaidInvoice(
  userId: string,
  opts: {
    processor: Processor;
    providerReference: string | undefined;
    amountMinor: number | undefined;
    currency: Currency;
    paidAt: Date | null;
    subscriptionId: string | null;
  },
): Promise<boolean> {
  // No reference (or no amount) → nothing to record; treat as no-op.
  if (!opts.providerReference || opts.amountMinor === undefined) return false;

  const inserted = await db
    .insert(invoices)
    .values({
      userId,
      subscriptionId: opts.subscriptionId,
      processor: opts.processor,
      providerReference: opts.providerReference,
      amountMinor: opts.amountMinor,
      currency: opts.currency,
      status: 'paid',
      paidAt: opts.paidAt,
    })
    .onConflictDoNothing({ target: invoices.providerReference })
    .returning({ id: invoices.id });

  return inserted.length > 0;
}

/** Shared post-mutation housekeeping: drop the plan cache + audit (system actor). */
async function afterMutation(
  userId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await bustPlanCache(userId);
  await recordAudit(db, {
    actorId: null,
    action,
    targetType: 'subscription',
    targetId: userId,
    metadata,
  }).catch(() => {});
}

// ----------------------------------------------------------------------------
// Graceful downgrade / restore — the "no silent data destruction" core.
// ----------------------------------------------------------------------------

/** routing_mode values that depend on a paid entitlement (geo/device/ab). */
const PAID_ROUTING_MODES = ['geo', 'device', 'ab'] as const;

/**
 * Suspend (do NOT delete) a user's paid power-link features when they fall to
 * free. We flip every link whose `routing_mode` is geo/device/ab back to
 * `single` so the hot path serves the link's default destination. The
 * `link_destinations` rows and any `password_hash` stay exactly as they were, so
 * a re-upgrade can restore the original behaviour losslessly.
 *
 * After flipping, we invalidate `keys.hotLink(code)` for the affected codes so
 * the redirect cache picks up the new single-destination routing immediately.
 */
export async function degradeUserToFree(userId: string): Promise<void> {
  const affected = await db
    .update(links)
    .set({ routingMode: 'single' })
    .where(
      and(eq(links.ownerId, userId), inArray(links.routingMode, [...PAID_ROUTING_MODES])),
    )
    .returning({ code: links.code });

  await invalidateHotLinks(affected.map((l) => l.code));
}

/**
 * Re-derive the correct `routing_mode` for a user's links from their PRESERVED
 * `link_destinations` rows when they (re-)gain a paid plan. The destination
 * `match.type` (geo | device | ab) tells us which mode the link was configured
 * for; we restore the strongest configured mode per link. Links with no
 * power-routing destinations stay `single`.
 *
 * Because downgrade never deleted destinations, this fully reconstructs the
 * pre-downgrade routing — no data was lost, only suspended.
 */
export async function restoreUserPlan(userId: string): Promise<void> {
  // Pull every power-routing destination for this user's links in one join.
  const rows = await db
    .select({
      linkId: links.id,
      code: links.code,
      currentMode: links.routingMode,
      matchType: linkDestinations.match,
    })
    .from(links)
    .innerJoin(linkDestinations, eq(linkDestinations.linkId, links.id))
    .where(and(eq(links.ownerId, userId), eq(links.routingMode, 'single')));

  // Reduce to one desired mode per link. A link's destinations are homogeneous
  // by match type in practice; if mixed, prefer ab > geo > device deterministically.
  const desired = new Map<string, { code: string; mode: 'geo' | 'device' | 'ab' }>();
  const RANK: Record<'ab' | 'geo' | 'device', number> = { ab: 3, geo: 2, device: 1 };
  for (const r of rows) {
    const t = (r.matchType as { type?: string } | null)?.type;
    if (t !== 'geo' && t !== 'device' && t !== 'ab') continue;
    const prev = desired.get(r.linkId);
    if (!prev || RANK[t] > RANK[prev.mode]) {
      desired.set(r.linkId, { code: r.code, mode: t });
    }
  }

  const codes: string[] = [];
  for (const [linkId, { code, mode }] of desired) {
    await db.update(links).set({ routingMode: mode }).where(eq(links.id, linkId));
    codes.push(code);
  }
  await invalidateHotLinks(codes);
}

/** Drop the redirect hot cache for a batch of codes (best-effort). */
async function invalidateHotLinks(codes: string[]): Promise<void> {
  if (codes.length === 0) return;
  await Promise.all(codes.map((code) => redis.del(keys.hotLink(code)).catch(() => {})));
}

// ----------------------------------------------------------------------------
// Provider event normalization — raw webhook payload → NormalizedEvent.
// ----------------------------------------------------------------------------

/**
 * Pull a clip.al userId out of provider metadata. Both processors echo back the
 * `metadata` we set at checkout; we standardise on `userId`.
 */
function metaString(meta: unknown, key: string): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const v = (meta as Record<string, unknown>)[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asPlan(v: string | undefined): PlanName | undefined {
  return v === 'free' || v === 'pro' || v === 'business' ? v : undefined;
}

function asInterval(v: string | undefined): Interval | undefined {
  return v === 'monthly' || v === 'yearly' ? v : undefined;
}

/**
 * Normalize a verified Paystack webhook envelope into a NormalizedEvent, or
 * `null` when the event is one we don't act on (or lacks a userId).
 *
 * Mapping:
 *   subscription.create  → activate
 *   charge.success       → charge.success (invoice paid + extend period)
 *   invoice.payment_failed / subscription.not_renew → past_due
 *   subscription.disable / subscription.expiring_cards → cancel
 *
 * Idempotency id (for billingEvents UNIQUE) is derived by the caller; here we
 * only translate shape.
 */
export function normalizePaystackEvent(parsed: {
  event: string;
  data: Record<string, unknown>;
}): NormalizedEvent | null {
  const { event, data } = parsed;
  const meta = data['metadata'];
  const customer = data['customer'] as Record<string, unknown> | undefined;
  const userId =
    metaString(meta, 'userId') ?? metaString(customer?.['metadata'], 'userId');
  if (!userId) return null;

  const plan = asPlan(metaString(meta, 'plan'));
  const interval = asInterval(metaString(meta, 'interval'));
  const common = {
    userId,
    ...(plan ? { plan } : {}),
    ...(interval ? { interval } : {}),
    currency: (data['currency'] as Currency | undefined) ?? 'NGN',
    paystackCustomerCode:
      (customer?.['customer_code'] as string | undefined) ??
      (data['customer_code'] as string | undefined),
    paystackSubscriptionCode: data['subscription_code'] as string | undefined,
    paystackEmailToken: data['email_token'] as string | undefined,
  };

  switch (event) {
    case 'subscription.create':
      return { processor: 'paystack', type: 'activate', data: { ...common } };
    case 'charge.success':
      return {
        processor: 'paystack',
        type: 'charge.success',
        data: {
          ...common,
          amountMinor:
            typeof data['amount'] === 'number' ? (data['amount'] as number) : undefined,
          providerReference: data['reference'] as string | undefined,
          paidAt: data['paid_at'] as string | undefined,
        },
      };
    case 'invoice.payment_failed':
    case 'subscription.not_renew':
      return { processor: 'paystack', type: 'past_due', data: { ...common } };
    case 'subscription.disable':
      return {
        processor: 'paystack',
        type: 'cancel',
        data: { ...common, cancelAtPeriodEnd: false },
      };
    default:
      return null;
  }
}

/**
 * Normalize a verified Polar webhook envelope (`{ type, data }`) into a
 * NormalizedEvent, or `null` when ignored / missing userId.
 *
 * Mapping:
 *   checkout.updated(status=succeeded) / subscription.created / .active → activate
 *   order.paid / order.created(paid)   → charge.success
 *   subscription.past_due              → past_due
 *   subscription.canceled / .revoked   → cancel (cancel vs revoke = at-period-end)
 */
export function normalizePolarEvent(parsed: {
  type: string;
  data: Record<string, unknown>;
}): NormalizedEvent | null {
  const { type, data } = parsed;
  const meta = data['metadata'];
  const userId = metaString(meta, 'userId');
  if (!userId) return null;

  const plan = asPlan(metaString(meta, 'plan'));
  const interval = asInterval(metaString(meta, 'interval'));
  const sub = (data['subscription'] as Record<string, unknown> | undefined) ?? data;
  const common = {
    userId,
    ...(plan ? { plan } : {}),
    ...(interval ? { interval } : {}),
    currency: 'USD' as Currency,
    polarCustomerId:
      (data['customer_id'] as string | undefined) ??
      (sub['customer_id'] as string | undefined),
    polarSubscriptionId:
      (data['subscription_id'] as string | undefined) ?? (sub['id'] as string | undefined),
    currentPeriodStart: sub['current_period_start'] as string | undefined,
    currentPeriodEnd: sub['current_period_end'] as string | undefined,
  };

  switch (type) {
    case 'subscription.created':
    case 'subscription.active':
      return { processor: 'polar', type: 'activate', data: { ...common } };
    case 'order.paid':
    case 'order.created':
      return {
        processor: 'polar',
        type: 'charge.success',
        data: {
          ...common,
          amountMinor:
            typeof data['amount'] === 'number'
              ? (data['amount'] as number)
              : typeof data['total_amount'] === 'number'
                ? (data['total_amount'] as number)
                : undefined,
          providerReference: (data['id'] as string | undefined) ?? undefined,
          paidAt: (data['created_at'] as string | undefined) ?? undefined,
        },
      };
    case 'subscription.past_due':
      return { processor: 'polar', type: 'past_due', data: { ...common } };
    case 'subscription.canceled':
      return {
        processor: 'polar',
        type: 'cancel',
        data: { ...common, cancelAtPeriodEnd: true },
      };
    case 'subscription.revoked':
      return {
        processor: 'polar',
        type: 'cancel',
        data: { ...common, cancelAtPeriodEnd: false },
      };
    default:
      return null;
  }
}

/**
 * Derive the idempotency `eventId` for a Paystack delivery. Paystack omits a
 * per-event id, so we synthesise a stable one from the event + the most specific
 * reference available (so a redelivery of the SAME charge collapses to one row).
 */
export function paystackEventId(parsed: {
  event: string;
  data: Record<string, unknown>;
}): string {
  const d = parsed.data;
  const ref =
    (d['reference'] as string | undefined) ??
    (d['subscription_code'] as string | undefined) ??
    (d['id'] !== undefined ? String(d['id']) : undefined) ??
    'unknown';
  return `${parsed.event}:${ref}`;
}

// ----------------------------------------------------------------------------
// Checkout & return flow — the only place provider SDKs are called.
// ----------------------------------------------------------------------------

export interface StartCheckoutResult {
  redirectUrl: string;
  processor: Processor;
  reference: string;
}

/**
 * Begin a paid checkout for `(plan, interval)`, geo-routing the processor by
 * `country` (NG → Paystack/NGN, else → Polar/USD). Returns the hosted redirect
 * URL the caller should send the browser to.
 *
 * Self-gating like the rest of the billing surface: if the routed processor is
 * not configured, this resolves `{ ok: false }` rather than throwing, so a
 * missing key degrades the UI to "billing unavailable" instead of a 500.
 *
 * Provider mapping of plan/interval → product:
 *  - Paystack: a plan code (`PLN_…`) per (plan, interval) from
 *    `PAYSTACK_PLAN_<PLAN>_<INTERVAL>` env (e.g. PAYSTACK_PLAN_PRO_MONTHLY).
 *    When absent we fall back to a one-off `initializeTransaction` with the
 *    effective price (still creates an invoice via charge.success).
 *  - Polar: a price id per (plan, interval) from `POLAR_PRICE_<PLAN>_<INTERVAL>`.
 */
export async function startCheckout(
  userId: string,
  plan: Exclude<PlanName, 'free'>,
  interval: Interval,
  country: string,
): Promise<{ ok: true; data: StartCheckoutResult } | { ok: false; error: string }> {
  const ctx = billingContext(country);
  const email = await userEmail(userId);
  if (!email) return { ok: false, error: 'user_not_found' };

  const amountMinor = await effectivePrice(plan, ctx.currency, interval);
  const baseUrl = getPublicBaseUrl();
  const metadata = { userId, plan, interval };

  if (ctx.processor === 'paystack') {
    if (!isPaystackConfigured()) return { ok: false, error: 'paystack_not_configured' };
    const planCode = providerEnv(`PAYSTACK_PLAN_${plan}_${interval}`.toUpperCase());
    const res = await initializeTransaction({
      email,
      amountMinor,
      currency: ctx.currency,
      ...(planCode ? { planCode } : {}),
      callbackUrl: `${baseUrl}/api/paystack/return`,
      metadata,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return {
      ok: true,
      data: {
        redirectUrl: res.data.authorizationUrl,
        processor: 'paystack',
        reference: res.data.reference,
      },
    };
  }

  // Polar (USD).
  if (!isPolarConfigured()) return { ok: false, error: 'polar_not_configured' };
  const priceId = providerEnv(`POLAR_PRICE_${plan}_${interval}`.toUpperCase());
  if (!priceId) return { ok: false, error: 'polar_price_not_configured' };
  const res = await createCheckout({
    productPriceId: priceId,
    customerEmail: email,
    successUrl: `${baseUrl}/api/polar/return`,
    metadata,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    data: { redirectUrl: res.data.checkoutUrl, processor: 'polar', reference: res.data.checkoutId },
  };
}

/**
 * Verify a checkout return and activate the subscription synchronously (so the
 * UI reflects the new plan immediately, ahead of the webhook). The webhook is
 * still the source of truth and is idempotent against whatever we do here.
 *
 * Paystack: verify the transaction by reference; on `success` apply a
 *   charge.success event (records the invoice + extends the period).
 * Polar: a checkout id alone isn't authoritative; we look up the bound
 *   subscription and, if active, apply an activate event. The order.paid webhook
 *   records the actual invoice.
 */
export async function verifyAndActivate(
  processor: Processor,
  reference: string,
): Promise<{ ok: true; plan: PlanName } | { ok: false; error: string }> {
  if (processor === 'paystack') {
    const res = await verifyTransaction(reference);
    if (!res.ok) return { ok: false, error: res.error };
    if (res.data.status !== 'success') return { ok: false, error: `status_${res.data.status}` };

    const userId = metaString(res.data.metadata, 'userId');
    if (!userId) return { ok: false, error: 'missing_user' };
    const plan = asPlan(metaString(res.data.metadata, 'plan'));
    const interval = asInterval(metaString(res.data.metadata, 'interval'));

    const result = await applyBillingEvent({
      processor: 'paystack',
      type: 'charge.success',
      data: {
        userId,
        ...(plan ? { plan } : {}),
        ...(interval ? { interval } : {}),
        currency: res.data.currency as Currency,
        amountMinor: res.data.amountMinor,
        providerReference: res.data.reference,
        ...(res.data.paidAt ? { paidAt: res.data.paidAt } : {}),
        paystackCustomerCode: res.data.customerCode,
        ...(res.data.subscriptionCode
          ? { paystackSubscriptionCode: res.data.subscriptionCode }
          : {}),
      },
    });
    return { ok: true, plan: result.plan };
  }

  // Polar — `reference` is the checkout id; resolve to the subscription.
  const sub = await getPolarSubscription(reference);
  if (!sub.ok) return { ok: false, error: sub.error };
  const userId = metaString(sub.data.metadata, 'userId');
  if (!userId) return { ok: false, error: 'missing_user' };
  if (sub.data.status !== 'active' && sub.data.status !== 'trialing') {
    return { ok: false, error: `status_${sub.data.status}` };
  }
  const plan = asPlan(metaString(sub.data.metadata, 'plan'));
  const interval = asInterval(metaString(sub.data.metadata, 'interval'));
  const result = await applyBillingEvent({
    processor: 'polar',
    type: 'activate',
    data: {
      userId,
      ...(plan ? { plan } : {}),
      ...(interval ? { interval } : {}),
      currency: 'USD',
      ...(sub.data.currentPeriodStart ? { currentPeriodStart: sub.data.currentPeriodStart } : {}),
      ...(sub.data.currentPeriodEnd ? { currentPeriodEnd: sub.data.currentPeriodEnd } : {}),
      cancelAtPeriodEnd: sub.data.cancelAtPeriodEnd,
      ...(sub.data.customerId ? { polarCustomerId: sub.data.customerId } : {}),
      polarSubscriptionId: sub.data.id,
    },
  });
  return { ok: true, plan: result.plan };
}

/** Look up a user's email (for provider checkout binding + receipts). */
async function userEmail(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.email ?? null;
}

/**
 * Read an OPTIONAL provider product-mapping env var (plan codes / price ids).
 * These are not part of the typed `@clipal/config` env (they're per-deployment
 * provider artefacts), so we read `process.env` directly and treat empty as
 * absent — matching the self-gating pattern used elsewhere.
 */
function providerEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

// Re-export the Paystack envelope parser the webhook route needs (it pairs with
// our normalizePaystackEvent), so the route imports both from one place.
export { parseWebhookEvent };
