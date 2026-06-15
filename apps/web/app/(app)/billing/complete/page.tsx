import { verifyAndActivate } from '@clipal/billing';
import type { PlanName } from '@clipal/config';
import { Button, Card, CardContent } from '@clipal/ui';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Completing checkout' };
export const dynamic = 'force-dynamic';

const PLAN_LABEL: Record<PlanName, string> = {
  free: 'Free',
  pro: 'Pro',
  business: 'Business',
};

/**
 * Checkout return handler (server component). Both providers redirect the browser
 * here after the hosted payment flow:
 *
 *  - Paystack appends `?reference=` (and a duplicate `?trxref=`). We verify the
 *    transaction synchronously via `verifyAndActivate('paystack', reference)` so
 *    the user's plan reflects the payment immediately, ahead of the webhook.
 *  - Polar appends `?checkout_id=` (its hosted-checkout id). We hand it to
 *    `verifyAndActivate('polar', checkoutId)`, which resolves the bound
 *    subscription and activates it.
 *
 * Verification is idempotent against the webhook (the source of truth), so a
 * double-activation here is harmless. We never trust query params for the user
 * identity — `verifyAndActivate` reads the userId from the *provider-verified*
 * metadata, not the request.
 */
export default async function BillingCompletePage({
  searchParams,
}: {
  searchParams: Promise<{
    reference?: string;
    trxref?: string;
    checkout_id?: string;
    checkoutId?: string;
  }>;
}) {
  // Gate on an authenticated session — only the buyer should land here.
  await requireUser();
  const params = await searchParams;

  const paystackRef = params.reference ?? params.trxref;
  const polarRef = params.checkout_id ?? params.checkoutId;

  let state: 'success' | 'failure' | 'missing' = 'missing';
  let plan: PlanName | null = null;
  let errorCode: string | null = null;

  if (paystackRef) {
    const res = await verifyAndActivate('paystack', paystackRef);
    if (res.ok) {
      state = 'success';
      plan = res.plan;
    } else {
      state = 'failure';
      errorCode = res.error;
    }
  } else if (polarRef) {
    const res = await verifyAndActivate('polar', polarRef);
    if (res.ok) {
      state = 'success';
      plan = res.plan;
    } else {
      state = 'failure';
      errorCode = res.error;
    }
  }

  return (
    <div className="mx-auto max-w-lg py-12">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          {state === 'success' ? (
            <>
              <CheckCircle2 className="size-10 text-emerald-500" strokeWidth={1.5} aria-hidden />
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-foreground">
                  Payment confirmed
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {plan && plan !== 'free'
                    ? `You're now on the ${PLAN_LABEL[plan]} plan. Your power features are active.`
                    : 'Your subscription is being set up. It may take a moment to reflect.'}
                </p>
              </div>
            </>
          ) : state === 'failure' ? (
            <>
              <XCircle className="size-10 text-red-500" strokeWidth={1.5} aria-hidden />
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-foreground">
                  We couldn’t confirm your payment
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {errorCode?.startsWith('status_')
                    ? 'The payment didn’t complete. If you were charged, it will reconcile automatically — please check back shortly.'
                    : 'Something went wrong verifying your checkout. If you were charged, your plan will update automatically once we receive confirmation.'}
                </p>
              </div>
            </>
          ) : (
            <>
              <XCircle className="size-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-foreground">
                  Nothing to confirm
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  This page completes a checkout. We didn’t find a checkout reference to verify.
                </p>
              </div>
            </>
          )}

          <Button asChild variant={state === 'success' ? 'primary' : 'secondary'} className="mt-2">
            <Link href="/billing">Go to billing</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
