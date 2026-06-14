# clip.al — Phase 2 Implementation Plan (Power Features & Monetization)

> Status: **PLAN — awaiting owner approval to start.** Source spec:
> `clipal-phase-2-power-features.md`. This doc is the durable plan (survives
> compaction). Grounded in a full read of the Phase 1 code (patterns cited inline).
> Phase 1 is merged + production-stable; the 4 audit fixes are on `main`.

## 0. How Phase 2 maps onto the existing architecture (ground truth)

- **Schema** (`packages/db/src/schema/*`): one file per table, barrel in `index.ts`,
  enums in `enums.ts`, custom `citext`/`inet` in `columns.ts`. Migrations via
  `pnpm migrate:create` (drizzle-kit generate) → `pnpm migrate` (tsx migrate.ts).
- **Config** (`packages/config`): `env.ts` zod schema (+ prod `superRefine`),
  `constants.ts`, `limits` export. **No `plans.ts` yet** — we add it as the single
  source of truth. Security sets load into Redis at boot via
  `packages/shorten/src/bootstrap.ts` (called from `apps/web/instrumentation.ts`).
- **Hot path** (`apps/web/app/r/[code]/route.ts`): Redis `link:hot:{code}` →
  `CachedLink {url, interstitial, safety, id, owner}` → raw pg `lookupLink`
  (`lib/hotpath.ts`, selects id, destination_url, owner_id, status, safety_state,
  interstitial_required). `/p` uses `resolveLink` (`lib/links.ts`). Click pipeline:
  `enqueueClick` XADD → worker `click-ingest` → ClickHouse + `links.clicks_total`.
  **Geo is worker-only today**; the `maxmind` lib is installed but the web
  container does NO request-time geo.
- **Worker** (`apps/worker`): tiny `every(name, ms, job)` scheduler (`scheduler.ts`),
  long-running stream consumers with consumer groups + DLQ (`loops/click-ingest.ts`),
  `workerState` + health server, native `fetch()`, `@clipal/email`. No BullMQ.
- **App/UI/API**: server-action pattern (`'use server'` + FormData +
  `requireUser`/`requireAdmin` + `recordAudit` + `revalidatePath`); admin RBAC via
  `(admin)/layout.tsx`. **No feature gating exists** (only role/status). API today =
  `/api/health`, `/api/ping`, `/logout` only — **no `/api/v1`**. UI = 33 primitives
  in `packages/ui`; charts are a custom CSS `BarChart` (no recharts/visx). CH query
  helpers in `packages/ch/src/queries.ts`. **No S3 client exists** (env vars only).
  Email = React/Resend templates. Middleware = CSP nonce + cookie-presence gate.

## 1. Workstreams (dependency-ordered)

### WS0 — Foundations (BLOCKS everything; build first)
| Deliverable | Notes |
|---|---|
| Schema: ~11 new tables | `subscriptions, invoices, billing_events, plan_prices, link_destinations, campaigns, api_keys, webhooks, webhook_deliveries, custom_domains, ads_placements` + enums (plan, subInterval, subStatus, currency, invoiceStatus, **processor=`paystack`\|`polar`**, routingMode, customDomainStatus, adSlot). One migration. **Dual-processor billing (see DECISION A1):** subscriptions/invoices carry a `processor` enum + provider-agnostic columns plus provider-specific (`paystack_subscription_code` / `polar_subscription_id`, etc.); `billing_events` (was `paystack_events`) handles BOTH webhooks idempotently with a `processor` column. |
| `links` columns | `custom_slug, password_hash, expires_at, max_clicks, routing_mode, campaign_id, domain_id`. Update unique index → `(coalesce(domain_id, zero-uuid), code)`. |
| `packages/config/src/plans.ts` | Code-level source of truth for per-plan **capabilities + limits** and **DEFAULT prices** (NGN minor + USD minor, monthly/yearly). Spec §3 values as defaults. |
| `plan_prices` table + admin (DECISION B1) | Admin-editable price overrides per (plan, currency, interval); plans.ts defaults are the fallback. Loaded into Redis at boot (bootstrap pattern). Pricing page + checkout read effective price = override ?? default. Admin UI under `/admin` (pricing). |
| App-settings layer (DECISION B2) | Lightweight admin-editable config (key→jsonb) with **code-baseline fallback**, loaded into Redis at boot. Backs: **profanity wordlist** (slug check) and **restricted-countries** (billing block). Baseline in code; admin can override. |
| `packages/billing` (plan engine) | `resolvePlan(user) → PlanName` (reads `subscriptions`, defaults free), `requireFeature(user, feature)`, capability map, usage Redis buckets (`usage:links:{userId}:{YYYYMM}`), `effectivePrice(plan, currency, interval)`, `billingContext(country) → {currency, processor}` (NG→NGN/Paystack, else USD/Polar). |
| `packages/s3` (new) | `@aws-sdk/client-s3` client (put/get/delete/presign) for QR cache + ad creatives. Wire `S3_*` env. |
| `packages/geo` (new, shared) | `mmdb-lib`/`maxmind` reader for **request-time** country lookup, used by web `/r`, the billing currency/processor router, AND worker. Web container gets `GeoLite2-Country.mmdb` via the existing `geoipdata` volume + refresh job (reuse `MAXMIND_LICENSE_KEY`). |
| New env vars | Paystack (`PAYSTACK_SECRET_KEY/PUBLIC_KEY/WEBHOOK_SECRET`, NGN plan codes), **Polar.sh** (`POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_ORG_ID`, USD product/price IDs), AdSense (`ADS_ENABLED`, `ADSENSE_CLIENT_ID`, slot IDs), `DOMAINS_CNAME_TARGET`, `CADDY_CHECK_ALLOWED_IP`. Add to `env.ts` (+ prod superRefine where required) and `.env.example`. |

### WS1 — Power link features (depends WS0)
| Feature | Where | Latency-critical? |
|---|---|---|
| Custom slugs | `packages/shorten` create path + `/links/new`; `CUSTOM_SLUG_REGEX` exists; profanity wordlist (config); scope-by-domain unique. | no |
| Password protection | argon2id (reuse auth params); `/p/[code]` password form → signed cookie `clipal_pw_{code}` (HMAC, 1h). | hot path: presence check only |
| Expiry / click-limit | `links.expires_at`/`max_clicks`; hot-path check; click-limit via **Redis Lua INCR-if-below** (1 round-trip); pages `/p/[code]/expired`, `/p/[code]/blocked`. | **YES (AC9)** |
| Geo routing | `link_destinations` rules; request-time geo (WS0 `packages/geo`); resolver first-match-wins. Admin `?_geo_override=US` (admin-only). | **YES (AC9)** |
| Device routing | UA parse in `/r`; resolver. | **YES (AC9)** |
| A/B testing | weighted variant pool + 30-day per-code cookie; `campaigns` + `/campaigns`, `/campaigns/[id]`. | **YES (AC9)** |
| QR codes | `qr-code-styling` + node-canvas; PNG+SVG; MinIO cache `(code, style_hash)`; monochrome+4 accents only. | no |
| Bulk CSV import | `csv-parse` stream; worker job `bulk-import` stream; ~50 rows/s (safety-API friendly); SSE progress; whole-file reject w/ error CSV. | no |
| **Hot-path payload + resolver** | Extend `CachedLink` (+`expiresAt, maxClicks, routingMode, hasPassword, domainId` and, when not `single`, the rule set). Extend `lookupLink` SELECT + `cacheSet` JSON. New `resolveDestination(link, ctx)`. **All checks O(1), after Redis GET, before 302.** | **YES (AC9 core)** |
| Pages | `/links/new` builder, `/links/[id]` extensions, `/links/bulk`. | — |

### WS2 — Dual billing: Paystack (NGN) + Polar.sh (USD) (depends WS0) — DECISION A1
- **Geo-routed processor/currency:** request country (WS0 `packages/geo`) → NG ⇒ NGN via
  **Paystack**; everywhere else ⇒ USD via **Polar.sh** (merchant-of-record, handles tax/VAT).
  Pricing page display currency follows geo (NG→NGN, else USD); a small "view in
  NGN/USD" affordance is informational, but **checkout currency+processor = geo-derived**
  (a Nigerian checks out in NGN/Paystack; everyone else USD/Polar). Restricted-countries
  (admin settings) block checkout with a polite message.
- `packages/paystack` (initialize tx, verify, subscriptions, plans) + `packages/polar`
  (Polar SDK/REST: checkout sessions, subscriptions, customer portal). A thin
  `packages/billing` provider interface unifies both behind `createCheckout`,
  `getSubscription`, `cancel`, `verifyWebhook`.
- Pages: `/pricing` (real, geo currency, segmented monthly/yearly, FAQ — design §13;
  prices from `plan_prices` admin override ?? plans.ts default), `/billing`,
  `/billing/complete` (Paystack `?reference=` and Polar return/callback).
- Webhooks: `POST /api/paystack/webhook` (HMAC **SHA512**) and `POST /api/polar/webhook`
  (Polar signature verify). Both insert into `billing_events` (processor-tagged) FIRST,
  then idempotent process. Worker `billing-processor` drains unprocessed (both providers).
- Subscription lifecycle (provider-agnostic): subscribe → activate; renewals/charge
  success/disable via each provider's webhook; cancel-at-period-end; **graceful
  downgrade** (no data destruction — geo links fall back to first dest, password links
  stay protected but uneditable until upgrade). Surface clearly in UI.
- Plan enforcement everywhere (WS0 `requireFeature` + usage buckets). Admin pricing
  config (DECISION B1). Admin: `/admin/subscriptions`, `/admin/invoices`,
  `/admin/pricing`. Email: subscription receipt (both processors).

### WS3 — Public REST API + outbound webhooks (depends WS0; WS1 for link ops)
- API keys: `clpl_(live|test)_…`; **sha256 prefix lookup + timing-safe compare**
  (per §14.2 — not argon2); scopes; per-key + per-plan rate limit; `last_used_at`.
- `/api/v1/*`: links CRUD, `:code/clicks` (CH, 90d), `:code/stats`, `POST /qr`,
  `GET /me`. Idempotency-Key (Redis 24h replay), cursor pagination (base64
  `(updated_at,id)`), error envelope `{error:{code,message,details}}`.
- OpenAPI 3.1 `apps/web/openapi.yaml` → `/api/v1/openapi.json` + Rapidoc `/docs/api`.
- Webhooks: `webhooks` + `webhook_deliveries`; HMAC `X-clipal-Signature: t=…,v1=…`;
  worker `webhook-delivery` stream consumer w/ exp backoff (1m,5m,30m,2h,12h),
  disable+email after 5 fails. Events: `link.created/updated/deleted` (actions),
  `link.clicked` (worker click-ingest), `link.threshold` (worker threshold detector),
  `link.flagged_safety` (rescan), `link.expired`.
- Pages: `/api-keys`, `/webhooks`, `/webhooks/[id]` (deliveries + replay). Admin
  `/admin/api-keys` (view prefix, revoke).

### WS4 — Custom domains (depends WS0; riskiest infra)
- `custom_domains` + `links.domain_id` scoping; add-domain flow on `/domains` (DNS
  instructions modal: CNAME→`domains.clip.al`, TXT `_clipal-verify`).
- Worker `domain-verifier` (DNS poll 60s, 24h then `error`) + `domain-tls-health`
  (daily). Caddy **on-demand TLS** + `GET /internal/caddy/check?domain=` (IP-restricted
  to Caddy container). Caddyfile + infra (`domains.clip.al` A record).
- Middleware: Host-based routing — non-app host → look up `custom_domains`, scope
  redirect resolver to that owner's links (`domain_id`). Slug gen scoped by domain.
- **Cloudflare (DECISION A3):** owner manages DNS on Cloudflare. `domains.clip.al` must
  be **DNS-only (grey cloud)** so Caddy on-demand TLS can complete the ACME challenge to
  our origin; document the Full(strict)+origin-cert alternative for proxied domains.
- Admin `/admin/domains`. **Hard to fully verify locally** (real DNS/TLS; same class
  as the Phase 1 Caddy/AC1 TODO).

### WS5 — AdSense + sponsored slots + bot defense (depends WS0; interstitial)
- `ads_placements`; interstitial renders real ads: sponsored (weighted) first, else
  AdSense fallback; slots `interstitial_top/bottom` (`tree_top` reserved Phase 3).
- Plan gating: free-owner links show ads on interstitial; Pro/Business links bypass
  interstitial entirely (set `interstitial_required=false` for paid owners).
- **Bot defense (account-ban-critical)**: UA bot list, `Sec-Fetch-*`, missing
  `Accept-Language`, **ASN datacenter denylist** (`packages/safety/asn-denylist.ts`),
  Turnstile invisible on interstitial → don't load AdSense if any trip. `noindex` on `/p`.
- **CMP/cookie consent** (Klaro or minimal self-rolled): defer ad scripts until
  consent; no ad scripts for EU/UK/CA without consent.
- Beacons: `POST /api/ads/impression/:id`, `/api/ads/click/:id`→302. Admin `/admin/ads`.

### WS6 — Cross-cutting (continuous)
- Design-system additions (§13): plan badges (F/P/B), pricing table, currency switch,
  API-docs page, stat cards, charts (mono). Keep monochrome discipline.
- Tests (vitest unit for resolver/plan/api-key/webhook-sign; e2e for upgrade + API).
- **AC9 bench**: re-run `scripts/bench-redirect.sh` with all hot-path checks enabled
  (ties to the Phase 1 AC7 TODO — needs prod topology for a real number).
- README: seed Paystack plans, wire AdSense, add custom domains. Audit-log every new
  admin action. zod + rate-limit on every new endpoint (AC11).

## 2. Dependency graph & recommended build order
```
WS0 (foundations) ──┬─► WS1 (power links)  ─► WS3 (API needs link ops)
                    ├─► WS2 (billing)       ─► gates WS1/WS3/WS5 features
                    ├─► WS4 (domains)        (parallel, infra-heavy)
                    └─► WS5 (ads)            (needs interstitial + WS2 gating)
```
**Recommended order:** WS0 → **WS2 + WS1-slice (custom slug + password)** to land
AC1 (upgrade→Pro→features) early → rest of WS1 (hot-path resolver + geo/device/AB +
expiry/limit; AC4/AC9) → WS3 (API + webhooks; AC5/AC6) → WS5 (ads; AC8) →
WS4 (domains; AC3, infra-gated). WS6 throughout.

## 3. Hot-path latency budget (AC9 — the #1 technical risk)
Every new check runs **after** the single Redis `GET` and **before** the 302, O(1):
- expiry / routing-mode / password-presence / domain scope → **from cached payload (free)**.
- click-limit → **one** Redis Lua `INCR`-if-below (atomic; replaces nothing else).
- geo/device routing → **in-memory** mmdb + UA parse (microseconds, no I/O).
Net added I/O on the worst-case direct redirect: **+1 Redis round-trip** (click-limit
only when `max_clicks` set). Keep `CachedLink` compact. **Re-bench after WS1.** (Note:
the Phase 1 single-process local bench already exceeded 100ms@1000; the real number
needs the prod topology — carried as the AC7 TODO.)

## 4. Acceptance-criteria → workstream map
1 upgrade→features WS2+WS1 · 2 cancel/downgrade WS2 · 3 custom domain TLS WS4 ·
4 geo routing WS1 · 5 API key create+POST WS3 · 6 webhook<10s WS3 · 7 bulk 1k<60s WS1 ·
8 ads gating+bot defense WS5 · 9 hot-path p95 WS1/WS6 · 10 pricing NGN/USD WS2 ·
11 indexes/rate-limit/zod/audit WS6 (all) · 12 README WS6.

## 5. Decisions (RESOLVED 2026-06-13 by owner)
- **A1 — Billing:** Polar.sh (USD, merchant-of-record) + Paystack (NGN). Geo-routed:
  country=NG → NGN/Paystack; else → USD/Polar. Display currency follows geo. (Overrides
  spec §2.6 "no new processors" — owner-approved.)
- **A2 — AdSense:** owner setting it up; WS5 proceeds, creds wired when ready.
- **A3 — Custom-domain DNS:** owner manages on Cloudflare; `domains.clip.al` DNS-only for
  on-demand TLS (Full(strict)+origin-cert documented as the proxied alternative).
- **A4 — GeoLite for web:** yes — mount `GeoLite2-Country.mmdb` via volume + refresh job,
  reuse `MAXMIND_LICENSE_KEY`.
- **B1 — Pricing:** admin-configurable. plans.ts = capabilities + default prices;
  `plan_prices` table = admin overrides; pricing/checkout use override ?? default.
- **B2 — Profanity wordlist + restricted-countries:** code baseline + admin-config layer
  (app-settings key→jsonb, Redis-loaded at boot, admin UI).
- **B3 — Team seats:** scaffolding only this phase (full collab Phase 3).
- **C1 — CMP:** lean self-rolled cookie-consent banner (safe/trusted, on-brand, zero deps);
  defers ad scripts until consent; EU/UK/CA gated.

**Still needed FROM OWNER as we reach each WS (NOT blocking WS0/WS1):** Paystack test/live
keys + NGN plan codes (WS2); Polar.sh access token + webhook secret + USD product/price IDs
(WS2); AdSense publisher + slot IDs (WS5); set `domains.clip.al` DNS-only A record (WS4).

## 6. Workflow strategy (post-approval)
Per-workstream `Workflow` runs: a **schema/scaffold** pass (parallel table+migration+
config), then **feature pipelines** (one agent per feature: schema-aware build →
adversarial review), with the **hot-path resolver done carefully in the main loop**
(latency-critical, single coherent change) and **verified by re-bench**. Custom-domain
and ads bot-defense get extra adversarial review (infra + account-ban risk).
