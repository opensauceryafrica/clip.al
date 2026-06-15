import { billingContext, effectivePrice, resolvePlan } from '@clipal/billing';
import {
  intervals,
  PLANS,
  planNames,
  type Currency,
  type Interval,
  type PlanName,
} from '@clipal/config';
import { db, desc, eq, invoices, subscriptions } from '@clipal/db';
import { lookupCountry } from '@clipal/geo';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@clipal/ui';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { PageHeader } from '@/components/page-header';
import { requireUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { getClientIp } from '@/lib/request';
import {
  cancelSubscriptionAction,
  resumeSubscriptionAction,
  startCheckoutAction,
} from './actions';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

// ---- Presentation helpers ---------------------------------------------------

/** Plan badge letters per §13 (F / P / B) and human label. */
const PLAN_META: Record<PlanName, { badge: string; label: string }> = {
  free: { badge: 'F', label: 'Free' },
  pro: { badge: 'P', label: 'Pro' },
  business: { badge: 'B', label: 'Business' },
};

/** Format a MINOR-unit amount (kobo / cents) for display. */
function formatMinor(amountMinor: number, currency: Currency): string {
  if (currency === 'NGN') {
    return `₦${Math.round(amountMinor / 100).toLocaleString('en-NG')}`;
  }
  // USD shown to the cent.
  return `$${(amountMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const INVOICE_BADGE: Record<string, 'active' | 'pending' | 'danger' | 'disabled'> = {
  paid: 'active',
  pending: 'pending',
  failed: 'danger',
  refunded: 'disabled',
};

const STATUS_BADGE: Record<string, 'active' | 'pending' | 'danger' | 'disabled'> = {
  active: 'active',
  past_due: 'danger',
  cancelled: 'pending',
  expired: 'disabled',
};

/** Monochrome plan badge — square chip with the plan letter (F / P / B). */
function PlanBadge({ plan }: { plan: PlanName }) {
  return (
    <span className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-muted text-xs font-semibold text-foreground">
      {PLAN_META[plan].badge}
    </span>
  );
}

/** Friendly copy for the `?error=` codes startCheckoutAction can bounce with. */
function describeError(code: string | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case 'paystack_not_configured':
    case 'polar_not_configured':
    case 'polar_price_not_configured':
      return 'Billing is temporarily unavailable. Please try again later.';
    case 'invalid_plan':
      return 'That plan can’t be purchased.';
    case 'user_not_found':
      return 'We couldn’t start checkout for your account.';
    default:
      return 'Something went wrong starting checkout. Please try again.';
  }
}

function describeNotice(code: string | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case 'cancel_scheduled':
      return 'Your subscription will not renew. You keep your plan until the period ends.';
    case 'resumed':
      return 'Your subscription was resumed and will keep renewing.';
    default:
      return null;
  }
}

// ---- Page -------------------------------------------------------------------

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireUser();
  const { error, notice } = await searchParams;

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);

  // The EFFECTIVE plan (respects lapsed/cancelled periods), independent of the
  // raw subscription row's `plan` column.
  const effectivePlan = await resolvePlan(user.id);

  const invoiceRows = await db
    .select({
      id: invoices.id,
      processor: invoices.processor,
      amountMinor: invoices.amountMinor,
      currency: invoices.currency,
      status: invoices.status,
      paidAt: invoices.paidAt,
      createdAt: invoices.createdAt,
      providerReference: invoices.providerReference,
    })
    .from(invoices)
    .where(eq(invoices.userId, user.id))
    .orderBy(desc(invoices.createdAt))
    .limit(50);

  // Geo-route the upgrade pricing shown on this page (NG ⇒ NGN/Paystack, else
  // USD/Polar). If the user already has a subscription currency, honour it so the
  // displayed renewal price matches what they actually pay.
  const hdrs = await headers();
  const country = lookupCountry(getClientIp(hdrs));
  const ctx = billingContext(country);
  const currency: Currency = (sub?.currency as Currency | undefined) ?? ctx.currency;

  // Upgrade matrix for the plans the user can move TO (anything above their
  // current effective plan that is paid).
  const upgradePrices: Record<string, Record<Interval, number>> = {};
  for (const plan of planNames) {
    if (plan === 'free') continue;
    const byInterval = {} as Record<Interval, number>;
    for (const int of intervals) {
      byInterval[int] = await effectivePrice(plan, currency, int);
    }
    upgradePrices[plan] = byInterval;
  }

  const rawStatus = sub?.status ?? 'active';
  const cancelPending = !!sub?.cancelAtPeriodEnd && effectivePlan !== 'free';
  const periodEnd = sub?.currentPeriodEnd ?? null;

  const errorMsg = describeError(error);
  const noticeMsg = describeNotice(notice);

  return (
    <div>
      <PageHeader title="Billing" description="Manage your plan, payment, and invoices." />

      {errorMsg ? (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {errorMsg}
        </div>
      ) : null}
      {noticeMsg ? (
        <div className="mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          {noticeMsg}
        </div>
      ) : null}

      <div className="space-y-6">
        {/* ---- Current plan ------------------------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <PlanBadge plan={effectivePlan} />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {PLAN_META[effectivePlan].label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {effectivePlan === 'free'
                      ? 'No active subscription.'
                      : sub?.interval === 'yearly'
                        ? 'Billed yearly'
                        : 'Billed monthly'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_BADGE[rawStatus] ?? 'neutral'}>{rawStatus}</Badge>
                {sub?.processor ? (
                  <Badge variant="neutral">
                    {sub.processor === 'paystack' ? 'Paystack' : 'Polar'}
                  </Badge>
                ) : null}
              </div>
            </div>

            {effectivePlan !== 'free' ? (
              <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-5 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {cancelPending ? 'Access until' : 'Renews on'}
                  </dt>
                  <dd className="mt-0.5 text-foreground">
                    {periodEnd ? formatDate(periodEnd) : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Next invoice</dt>
                  <dd className="mt-0.5 text-foreground">
                    {cancelPending
                      ? 'None — cancels at period end'
                      : periodEnd
                        ? `${formatMinor(
                            upgradePrices[effectivePlan]?.[
                              (sub?.interval as Interval | undefined) ?? 'monthly'
                            ] ?? 0,
                            currency,
                          )} on ${formatDate(periodEnd)}`
                        : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Payment method</dt>
                  <dd className="mt-0.5 text-foreground">
                    {sub?.processor === 'paystack'
                      ? 'Paystack (NGN)'
                      : sub?.processor === 'polar'
                        ? 'Polar.sh (USD)'
                        : '—'}
                  </dd>
                </div>
              </dl>
            ) : null}

            {/* Graceful-downgrade banner. */}
            {cancelPending ? (
              <div className="mt-5 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {PLAN_META[effectivePlan].label} until {periodEnd ? formatDate(periodEnd) : 'the period end'}
                </span>
                , then your account downgrades to Free. Your power-link configurations
                (routing, passwords, expiry) are preserved and reactivate automatically if
                you resubscribe.
              </div>
            ) : null}

            {/* Plan controls. */}
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-5">
              {effectivePlan !== 'free' && !cancelPending ? (
                <form action={cancelSubscriptionAction}>
                  <Button type="submit" variant="secondary" size="sm">
                    Cancel subscription
                  </Button>
                </form>
              ) : null}
              {cancelPending ? (
                <form action={resumeSubscriptionAction}>
                  <Button type="submit" variant="primary" size="sm">
                    Resume subscription
                  </Button>
                </form>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* ---- Change / upgrade plan -------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>{effectivePlan === 'free' ? 'Upgrade' : 'Change plan'}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Prices shown in {currency === 'NGN' ? 'Naira (₦)' : 'US Dollars ($)'} via{' '}
              {ctx.processor === 'paystack' ? 'Paystack' : 'Polar.sh'}.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {planNames
                .filter((p): p is Exclude<PlanName, 'free'> => p !== 'free')
                .map((plan) => {
                  const isCurrent = plan === effectivePlan && !cancelPending;
                  const monthly = upgradePrices[plan]?.monthly ?? 0;
                  const yearly = upgradePrices[plan]?.yearly ?? 0;
                  return (
                    <div
                      key={plan}
                      className="rounded-lg border border-border bg-card p-4"
                    >
                      <div className="flex items-center gap-2">
                        <PlanBadge plan={plan} />
                        <span className="text-sm font-medium text-foreground">
                          {PLAN_META[plan].label}
                        </span>
                        {isCurrent ? (
                          <Badge variant="active" className="ml-auto">
                            Current
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                        {formatMinor(monthly, currency)}
                        <span className="text-sm font-normal text-muted-foreground">/mo</span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        or {formatMinor(yearly, currency)}/yr
                      </p>
                      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                        {plan === 'pro' ? (
                          <>
                            <li>No interstitial on your links</li>
                            <li>Custom back-halves, passwords, expiry, QR</li>
                            <li>A/B testing · 1 custom domain</li>
                          </>
                        ) : (
                          <>
                            <li>Everything in Pro</li>
                            <li>Geo &amp; device routing</li>
                            <li>{PLANS.business.limits.teamSeats} seats · higher limits</li>
                          </>
                        )}
                      </ul>
                      {isCurrent ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="mt-4 w-full"
                          disabled
                        >
                          Your current plan
                        </Button>
                      ) : (
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <form action={startCheckoutAction}>
                            <input type="hidden" name="plan" value={plan} />
                            <input type="hidden" name="interval" value="monthly" />
                            <Button type="submit" variant="primary" size="sm" className="w-full">
                              Monthly
                            </Button>
                          </form>
                          <form action={startCheckoutAction}>
                            <input type="hidden" name="plan" value={plan} />
                            <input type="hidden" name="interval" value="yearly" />
                            <Button type="submit" variant="secondary" size="sm" className="w-full">
                              Yearly
                            </Button>
                          </form>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>

        {/* ---- Invoice history -------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice history</CardTitle>
          </CardHeader>
          <CardContent>
            {invoiceRows.length === 0 ? (
              <EmptyState
                title="No invoices yet"
                description="Invoices appear here after your first successful payment."
              />
            ) : (
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoiceRows.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(inv.paidAt ?? inv.createdAt)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatMinor(inv.amountMinor, inv.currency as Currency)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {inv.processor === 'paystack' ? 'Paystack' : 'Polar'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={INVOICE_BADGE[inv.status] ?? 'neutral'}>
                            {inv.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
