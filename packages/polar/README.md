# @clipal/polar

Fetch-based [Polar.sh](https://polar.sh) client + webhook verification for clip.al's
**USD** billing leg. Polar is the merchant-of-record (it handles tax/remittance) for
non-NGN customers; NGN goes to Paystack. Geo routing lives in `@clipal/billing`
(`billingContext(country)` → `{ currency: 'USD', processor: 'polar' }`).

Like GSB/Paystack, Polar is **optional and self-gating**: every call short-circuits when
`POLAR_ACCESS_TOKEN` is missing/placeholder, and **no call throws** on a non-2xx — callers
branch on the discriminated `PolarResult.ok`.

## Exports

| Export | Signature | Polar endpoint |
| --- | --- | --- |
| `isPolarConfigured()` | `() => boolean` | — (token presence gate) |
| `createCheckout(params)` | `({ productPriceId, customerEmail, successUrl, metadata? }) => PolarResult<{ checkoutUrl, checkoutId }>` | `POST /v1/checkouts/` |
| `getSubscription(id)` | `(id) => PolarResult<PolarSubscription>` | `GET /v1/subscriptions/{id}` |
| `cancelSubscription(id, atPeriodEnd)` | `(id, boolean) => PolarResult<PolarSubscription>` | `PATCH` (at period end) / `DELETE` (immediate) `/v1/subscriptions/{id}` |
| `isPolarWebhookConfigured()` | `() => boolean` | — (secret presence gate) |
| `verifyWebhookSignature(rawBody, headers, opts?)` | `(string, HeadersLike, { toleranceSeconds?, now? }?) => boolean` | — (Standard Webhooks verify) |

Base URL: `https://api.polar.sh`. Auth: `Authorization: Bearer <POLAR_ACCESS_TOKEN>`.

## Webhooks

Polar signs webhooks with the [Standard Webhooks](https://www.standardwebhooks.com) scheme
(`webhook-id` / `webhook-timestamp` / `webhook-signature`). `verifyWebhookSignature`:

- HMAC-SHA256's `${id}.${timestamp}.${rawBody}` with `POLAR_WEBHOOK_SECRET`
  (`whsec_<base64>`, prefix optional), base64-encoded;
- compares **timing-safely** against each `v1,<sig>` token in `webhook-signature`;
- rejects timestamps outside a ±5 min tolerance (replay defense);
- returns a plain `boolean` and **never throws** (malformed input → `false`).

Pass the **raw** request body (`await request.text()`), never a re-serialized object.

The webhook route handler (owned by the web app) should: read the raw body, call
`verifyWebhookSignature`, insert a `billingEvents` row first (idempotent via
`UNIQUE(processor, eventId)` keyed off `webhook-id`), then process. Relevant Polar event
types: `checkout.created`/`checkout.updated`, `subscription.created`/`.updated`/`.active`/
`.canceled`/`.revoked`, `order.created`/`order.paid`.

## Tests

`pnpm --filter @clipal/polar test` — unit tests for `verifyWebhookSignature` (valid/tampered/
wrong-secret/stale/missing-header/`Headers`-instance/`whsec_`-and-raw-secret) and the
`isPolarConfigured` / `isPolarWebhookConfigured` gates. No network is touched.
