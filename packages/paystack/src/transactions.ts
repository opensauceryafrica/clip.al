import { paystackRequest, type PaystackResult } from './client';

/**
 * Paystack expects amounts in the SUBUNIT of the currency (kobo for NGN, cents
 * for USD) — which is exactly our `amountMinor` convention, so no conversion.
 * @see https://paystack.com/docs/api/transaction/
 */
export interface InitializeTransactionParams {
  email: string;
  /** Amount in the currency subunit (kobo/cents). */
  amountMinor: number;
  /** ISO currency, e.g. 'NGN'. Defaults to Paystack account default if omitted. */
  currency?: string;
  /** Paystack plan code (`PLN_…`) — when present, the charge creates a subscription. */
  planCode?: string;
  /** Where Paystack redirects the customer after payment. */
  callbackUrl?: string;
  /** Arbitrary metadata echoed back on the transaction & webhooks. */
  metadata?: Record<string, unknown>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

interface RawInitialize {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/**
 * Initialize a transaction → hosted Paystack checkout URL the user is redirected
 * to. `POST /transaction/initialize`.
 * @see https://paystack.com/docs/api/transaction/#initialize
 */
export async function initializeTransaction(
  params: InitializeTransactionParams,
): Promise<PaystackResult<InitializeTransactionResult>> {
  const body: Record<string, unknown> = {
    email: params.email,
    amount: params.amountMinor,
  };
  if (params.currency !== undefined) body['currency'] = params.currency;
  if (params.planCode !== undefined) body['plan'] = params.planCode;
  if (params.callbackUrl !== undefined) body['callback_url'] = params.callbackUrl;
  if (params.metadata !== undefined) body['metadata'] = params.metadata;

  const res = await paystackRequest<RawInitialize>('/transaction/initialize', { body });
  if (!res.ok) return res;

  return {
    ok: true,
    status: res.status,
    data: {
      authorizationUrl: res.data.authorization_url,
      accessCode: res.data.access_code,
      reference: res.data.reference,
    },
  };
}

export type PaystackTransactionStatus = 'success' | 'failed' | 'abandoned' | 'pending' | string;

export interface VerifyTransactionResult {
  status: PaystackTransactionStatus;
  reference: string;
  /** Amount paid, in the currency subunit. */
  amountMinor: number;
  currency: string;
  /** Customer code (`CUS_…`), stored as `subscriptions.paystackCustomerCode`. */
  customerCode: string;
  customerEmail: string;
  /**
   * Subscription code (`SUB_…`) — only present when the plan attached to the
   * transaction created a subscription. Stored as `paystackSubscriptionCode`.
   */
  subscriptionCode?: string;
  /** ISO-8601 time the charge settled, when available. */
  paidAt?: string;
  /** Authorization (card/bank) token, reusable for future charges. */
  authorizationCode?: string;
  metadata?: Record<string, unknown>;
}

interface RawVerify {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at?: string | null;
  metadata?: Record<string, unknown> | string | null;
  customer?: { customer_code?: string; email?: string } | null;
  authorization?: { authorization_code?: string } | null;
  plan_object?: { subscription_code?: string } | null;
  subscription_code?: string | null;
}

/**
 * Verify a transaction by reference — the authoritative source of truth for
 * payment status (do not trust the redirect alone). `GET /transaction/verify/:reference`.
 * @see https://paystack.com/docs/api/transaction/#verify
 */
export async function verifyTransaction(
  reference: string,
): Promise<PaystackResult<VerifyTransactionResult>> {
  const res = await paystackRequest<RawVerify>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  if (!res.ok) return res;

  const d = res.data;
  const subscriptionCode = d.plan_object?.subscription_code ?? d.subscription_code ?? undefined;
  const metadata =
    d.metadata && typeof d.metadata === 'object'
      ? (d.metadata as Record<string, unknown>)
      : undefined;

  return {
    ok: true,
    status: res.status,
    data: {
      status: d.status,
      reference: d.reference,
      amountMinor: d.amount,
      currency: d.currency,
      customerCode: d.customer?.customer_code ?? '',
      customerEmail: d.customer?.email ?? '',
      ...(subscriptionCode ? { subscriptionCode } : {}),
      ...(d.paid_at ? { paidAt: d.paid_at } : {}),
      ...(d.authorization?.authorization_code
        ? { authorizationCode: d.authorization.authorization_code }
        : {}),
      ...(metadata ? { metadata } : {}),
    },
  };
}
