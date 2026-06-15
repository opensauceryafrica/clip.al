import { paystackRequest, type PaystackResult } from './client';

/**
 * Subscription helpers. Paystack subscriptions are normally created implicitly
 * by attaching a `plan` to an initialized transaction (see
 * `initializeTransaction`), but can also be created explicitly from an existing
 * customer + authorization.
 * @see https://paystack.com/docs/api/subscription/
 */
export interface CreateSubscriptionParams {
  /** Customer code (`CUS_…`) or email. */
  customer: string;
  /** Plan code (`PLN_…`). */
  planCode: string;
  /** Authorization code (`AUTH_…`) to charge; required when the customer has many. */
  authorizationCode?: string;
  /** ISO-8601 date for the first charge; omit to start immediately. */
  startDate?: string;
}

export interface CreateSubscriptionResult {
  subscriptionCode: string;
  /** Email-OTP token Paystack requires to disable a subscription. */
  emailToken: string;
  status: string;
}

interface RawSubscription {
  subscription_code: string;
  email_token: string;
  status: string;
}

/**
 * Create a subscription explicitly. `POST /subscription`.
 * @see https://paystack.com/docs/api/subscription/#create
 */
export async function createSubscription(
  params: CreateSubscriptionParams,
): Promise<PaystackResult<CreateSubscriptionResult>> {
  const body: Record<string, unknown> = {
    customer: params.customer,
    plan: params.planCode,
  };
  if (params.authorizationCode !== undefined) body['authorization'] = params.authorizationCode;
  if (params.startDate !== undefined) body['start_date'] = params.startDate;

  const res = await paystackRequest<RawSubscription>('/subscription', { body });
  if (!res.ok) return res;

  return {
    ok: true,
    status: res.status,
    data: {
      subscriptionCode: res.data.subscription_code,
      emailToken: res.data.email_token,
      status: res.data.status,
    },
  };
}

export interface DisableSubscriptionParams {
  /** Subscription code (`SUB_…`), stored as `paystackSubscriptionCode`. */
  subscriptionCode: string;
  /** Email token from create/verify, stored as `paystackEmailToken`. */
  emailToken: string;
}

/**
 * Disable (cancel) a subscription. `POST /subscription/disable`. Both the
 * subscription code and the email token are required by Paystack.
 * @see https://paystack.com/docs/api/subscription/#disable
 */
export async function disableSubscription(
  params: DisableSubscriptionParams,
): Promise<PaystackResult<{ disabled: true }>> {
  const res = await paystackRequest<unknown>('/subscription/disable', {
    body: { code: params.subscriptionCode, token: params.emailToken },
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: { disabled: true } };
}

/**
 * Enable a (re-activate a) subscription. `POST /subscription/enable`.
 * @see https://paystack.com/docs/api/subscription/#enable
 */
export async function enableSubscription(
  params: DisableSubscriptionParams,
): Promise<PaystackResult<{ enabled: true }>> {
  const res = await paystackRequest<unknown>('/subscription/enable', {
    body: { code: params.subscriptionCode, token: params.emailToken },
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: { enabled: true } };
}
