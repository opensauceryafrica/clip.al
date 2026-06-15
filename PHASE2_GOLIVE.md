# clip.al — Phase 2 go-live: credentials + testing story

Phase 2 (power links, dual billing, REST API + webhooks, custom domains, ads) is
**built and merged** (commits `f456f7f`..`567a632`). What remains is **operator
wiring** — credentials and a deploy — plus confirming the live behaviors that can't
be tested on a laptop. This doc is the checklist.

---

## 1. Credentials & env vars to set

All live in `.env` (copy from `.env.example`, which documents every variable). Each
integration **self-gates on its key**: leave it blank and that feature stays off.

### Already required from Phase 1 (set these first in prod)
| Var | What | Where |
|---|---|---|
| `SESSION_SECRET` | 64 random bytes hex | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `DATABASE_URL`, `POSTGRES_*`, `REDIS_URL`, `CLICKHOUSE_*`, `MINIO_*`/`S3_*` | datastore creds | your infra |
| `RESEND_API_KEY`, `EMAIL_FROM` | transactional email | resend.com (verified domain) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | CAPTCHA | Cloudflare Turnstile |
| `GSB_API_KEY` | URL safety scan | Google Safe Browsing v4 |
| `MAXMIND_LICENSE_KEY` | GeoLite2 (geo routing + billing currency) | maxmind.com (free) — also mount a Country/City `.mmdb` into the **web** container's `geoipdata` volume, not just the worker |

### Phase 2 — Billing (NGN via Paystack, USD via Polar)
| Var | What | Where |
|---|---|---|
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` | API keys (use **test** first) | Paystack dashboard → Settings → API Keys |
| `PAYSTACK_WEBHOOK_SECRET` | webhook signing secret | Paystack → Settings → Webhooks; point it at `https://clip.al/api/paystack/webhook` |
| `POLAR_ACCESS_TOKEN`, `POLAR_ORG_ID` | API token + org | polar.sh org settings |
| `POLAR_WEBHOOK_SECRET` | webhook secret | Polar → Webhooks; endpoint `https://clip.al/api/polar/webhook` |
| (dashboard, not env) | Paystack **NGN Plans** + Polar **USD products/prices**, one per tier×interval (Pro/Business × monthly/yearly) | create in each dashboard |
| (admin UI, not env) | per-plan prices | editable at `/admin/pricing` — overrides the defaults in `packages/config/src/plans.ts` |

### Phase 2 — Ads (AdSense)
| Var | What | Where |
|---|---|---|
| `ADS_ENABLED` | `true` to turn ads on (default `false`) | — |
| `ADSENSE_CLIENT_ID` | `ca-pub-…` | Google AdSense (after approval) |
| (code, not env) | real ad-unit slot ids | replace the `ADSENSE_SLOT_IDS` placeholders in `apps/web/components/ad-slot.tsx` |

Sponsored campaigns (which take priority over AdSense) need **no keys** — manage them
at `/admin/ads`.

### Phase 2 — Custom domains
| Var | What | Where |
|---|---|---|
| `DOMAINS_CNAME_TARGET` | the CNAME target customers point at (default `domains.clip.al`) | — |
| `CADDY_CHECK_ALLOWED_IP` | the Caddy container's IP (gates on-demand-TLS issuance) | your infra |
| (DNS, not env) | an A record for `domains.clip.al` → the server, **DNS-only** (grey cloud) on Cloudflare | Cloudflare |

> **Where to see all of this in one place:** [`.env.example`](.env.example) (every var
> with a comment), the **Phase 2 operations** section of [`README.md`](README.md), and
> this file. Plan rationale is in [`PHASE2_PLAN.md`](PHASE2_PLAN.md).

---

## 2. Deploy prerequisite

WS0 added ~11 tables. After pulling, **run the migration in prod**: `make migrate`
(or `pnpm migrate`). For the redirect benchmark you also need a real serving
topology (Caddy + ≥1 web replica) — `make up` / `make up-prod`.

---

## 3. Testing story (in order)

Locally I've already verified the mechanisms that don't need creds (see the
"verified" column below). The steps here are what **you** run once creds + deploy
are in, to sign off the gated criteria.

| # | Criterion | How to test | Already verified locally? |
|---|---|---|---|
| AC1 | Upgrade → Pro unlocks features | `/pricing` → "Choose Pro" → Paystack (if your IP is NG) or Polar checkout → on return `/billing` shows **Pro active** → `/links/new` now lets you set a custom back-half + password | gating logic + password gate ✅; live checkout ⏳ creds |
| AC2 | Cancel → graceful downgrade | `/billing` → Cancel (cancel-at-period-end) → at period end the plan flips to Free → confirm a geo link now serves its **default** destination and a password link is **still protected but uneditable** (no data lost) | state machine + degrade/restore unit-tested ✅; live ⏳ creds |
| AC3 | Custom domain serves HTTPS | `/domains` → add `go.yourbrand.com` → set the shown **CNAME** + **TXT** records → wait for status `pending_dns → pending_tls → active` → open `https://go.yourbrand.com/<code>` → cert issued, redirect works | CRUD + caddy-check (200/404/400) ✅; live cert ⏳ DNS+Caddy |
| AC4 | Geo routing | Create a link with geo rules; `curl --resolve` from NG vs US, or as admin `/r/<code>?_geo_override=US` vs `=NG` | ✅ fully (override US→US dest, NG→default, non-admin ignored) |
| AC5 | API key → create link | `/api-keys` → create (copy the once-shown key) → `curl -XPOST https://clip.al/api/v1/links -H "Authorization: Bearer clpl_live_…" -d '{"destination":"https://example.com"}'` → 201 + link object | ✅ fully |
| AC6 | Webhook on click | `/webhooks` → add an endpoint (e.g. webhook.site) subscribed to `link.clicked` → click a link → receiver gets a POST with `X-clipal-Signature` within ~10s; verify HMAC | ✅ fully (signed, signature valid) |
| AC7 | Bulk 1k import < 60s | `/links/bulk` → upload a 1,000-row CSV → progress completes; rows respect URL safety | worker loop live ✅; throughput on prod ⏳ |
| AC8 | Ads: free shows / paid + datacenter don't | Set `ADS_ENABLED=true` + AdSense id. Visit a free link's `/p/:code` (consent accepted) → ad renders; a Pro owner's link skips the interstitial entirely; from a datacenter IP → no ad | ✅ gate (residential+consent shows, datacenter/bot blocked); live AdSense fill ⏳ id |
| AC9 | Redirect p95 < 100ms | Deploy (web×2 behind Caddy); warm a **direct** link; `scripts/bench-redirect.sh <code> https://clip.al 20s 1000` | hot-path correct, 0 added round-trips on warm path ✅; prod number ⏳ topology |
| AC10 | Pricing NGN + USD, no nav on toggle | Open `/pricing`; the currency defaults by your country; the NGN/USD + Monthly/Yearly toggles switch prices without a page load | ✅ fully (both currencies in DOM) |
| AC11 | Indexes / rate-limits / zod / audit | code review — new tables indexed (migration `0003`), `/api/v1` rate-limited per key+plan, webhooks signature-gated, admin actions write `audit_log` | ✅ |

### Re-running the local smokes (regression)
The exact curl/SQL recipes I used are in the commit history + memory; the high-value
ones: power-link gates on `/r/<code>`, the `?_geo_override` geo check (mint a JWT
with `jose` from inside `apps/web`), the API with a hand-inserted `api_keys` row, and
the webhook delivery via a tiny local HTTP catcher. Note: stop the old container
worker (`docker stop clipal-worker-1`) before smoke-testing worker features with a
fresh `pnpm dev:worker`, or the stale image may grab the message.
