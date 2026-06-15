# @clipal/paystack

Thin, fetch-based client for the [Paystack REST API](https://paystack.com/docs/api/)
— no SDK dependency. Powers the **NGN** half of clip.al's dual billing (country
`NG` ⇒ NGN via Paystack; else ⇒ USD via Polar). Geo-routing lives in
`@clipal/billing` (`billingContext`); this package only talks to Paystack.

## Self-gating

Like GSB, every feature self-gates on key presence. `isPaystackConfigured()` is
true only when `env.PAYSTACK_SECRET_KEY` is set and not a placeholder. When
false, no network call is attempted and calls return a typed failure result.

## Non-throwing

No call throws on a non-2xx response, network error, or unconfigured key. Every
request returns a `PaystackResult<T>` discriminated union — callers branch on
`ok`. A Paystack outage must never 500 a billing action.

```ts
const res = await initializeTransaction({ email, amountMinor, currency: 'NGN' });
if (res.ok) redirect(res.data.authorizationUrl);
else handle(res.error);
```

## Amounts

Paystack amounts are in the currency **subunit** (kobo for NGN, cents for USD),
which is exactly our `amountMinor` convention — no conversion.

## Exports

| Export | Purpose |
| --- | --- |
| `isPaystackConfigured()` | key present & not placeholder |
| `initializeTransaction(params)` | `POST /transaction/initialize` → `{ authorizationUrl, accessCode, reference }` |
| `verifyTransaction(reference)` | `GET /transaction/verify/:reference` → `{ status, customerCode, subscriptionCode?, amountMinor, ... }` |
| `createSubscription(params)` | `POST /subscription` → `{ subscriptionCode, emailToken, status }` |
| `disableSubscription(params)` | `POST /subscription/disable` (needs code + emailToken) |
| `enableSubscription(params)` | `POST /subscription/enable` |
| `verifyWebhookSignature(rawBody, header)` | timing-safe HMAC-SHA512 of the **raw** body |
| `parseWebhookEvent(rawBody)` | typed `{ event, data }` envelope (verify first) |
| `paystackRequest<T>(path, opts)` | low-level escape hatch |

## Webhooks

Paystack signs the **raw** request body with HMAC-SHA512 keyed on the secret
key, sent in `x-paystack-signature`. Verify against `request.text()` (never
re-serialized JSON). Paystack has no per-event id — derive an idempotency key
(e.g. `${event}:${data.reference ?? data.subscription_code}`) for the
`billingEvents` `UNIQUE(processor, eventId)` constraint.

## Documented endpoints used

- `POST https://api.paystack.co/transaction/initialize`
- `GET  https://api.paystack.co/transaction/verify/:reference`
- `POST https://api.paystack.co/subscription`
- `POST https://api.paystack.co/subscription/disable`
- `POST https://api.paystack.co/subscription/enable`

All authenticated with `Authorization: Bearer <PAYSTACK_SECRET_KEY>`.
