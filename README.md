# clip.al

A fast, safe URL shortener and link manager. **Phase 1: Core Foundation.**

Anonymous + authenticated shortening, a redirect hot path built for 10k+ rps,
URL safety scanning at submission and on a rolling basis, a 5-second interstitial
preview, dashboard analytics backed by ClickHouse, and a lean admin. Everything is
self-hosted via Docker Compose; the only external SaaS is Resend (email).

> This is Phase 1 of 3. Phases 2 (monetization/power features) and 3 (link tree /
> full admin) are intentionally **not** built. See `clipal-phase-1-core.md` §21.

---

## Architecture

```
Caddy (TLS, X-Real-IP)  ──► web (Next.js 15, Node runtime)
                                 ├─ /r/[code]  redirect hot path  ─┐
                                 ├─ /p/[code]  interstitial        │  XADD
                                 ├─ dashboard / admin / marketing  │
                                 └─ /api/health                    ▼
Postgres 16 ◄── Drizzle ── web/worker          Redis 7 (hot cache, rate limits,
ClickHouse 24 ◄── click events ── worker ◄───── click stream, session denylist)
MinIO (S3)                         worker: ingest · re-scan · reapers · salt
```

- **Redirect hot path** (`apps/web/app/r/[code]/route.ts`) never blocks on the DB
  for cached links: Redis GET → (miss) one indexed Postgres query → 302. It uses a
  dedicated raw `postgres` pool, not the ORM, and is excluded from middleware.
- **Click pipeline**: the request path only `XADD`s to a Redis stream. The worker
  drains it, enriches (UA/geo/salted-IP-hash), batch-inserts to ClickHouse, and
  updates the denormalized `links.clicks_total`.

### Monorepo layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js app — redirect, interstitial, marketing, auth, dashboard, admin |
| `apps/worker` | click ingest, URL re-scan, reapers, salt rotation |
| `packages/config` | zod env validation + shared constants |
| `packages/db` | Drizzle schema + client + migrator (Postgres) |
| `packages/cache` | Redis client, key conventions, rate limiter, membership sets |
| `packages/ch` | ClickHouse client + analytics queries |
| `packages/auth` | passwordless codes (argon2id), JWT, sessions, Turnstile |
| `packages/safety` | URL validation, SSRF guards, blocklist, Google Safe Browsing |
| `packages/shorten` | slug generation, collision retry, link creation |
| `packages/email` | Resend client + React Email templates |
| `packages/ui` | Vercel-monochrome design system |
| `infra/` | Docker Compose, Caddyfile, ClickHouse DDL |
| `scripts/` | abbrefy importer, admin seeder, redirect benchmark |

---

## Prerequisites

- **Docker** + Docker Compose (for the full stack)
- **Node 22 LTS** and **pnpm 9** (for local dev / migrations / scripts)
- Accounts/keys: **Resend** (email), **Cloudflare Turnstile** (free), **Google
  Safe Browsing** API key (free). Optional: a **MaxMind** license key for GeoLite2.

---

## Quickstart (full stack)

```bash
cp .env.example .env
# Fill in SESSION_SECRET, DB/MinIO passwords, and the SaaS keys. Generate a secret:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

make up                 # build + start postgres, redis, clickhouse, minio, web, worker, caddy
make migrate            # apply Drizzle migrations (creates citext, then tables)
make seed               # create the initial admin from INITIAL_ADMIN_EMAIL
make health             # check every backing service
```

Then open the app (behind Caddy on 80/443 in prod, or `http://localhost:3000`
directly in dev). `make logs S=web` tails a service. `make down` stops; `make
clean` stops **and deletes volumes** (data loss).

Optional error tracking: `make up-obs` adds self-hosted GlitchTip (see
`infra/docker-compose.observability.yml`), then set `SENTRY_DSN`.

## Quickstart (local dev, datastores in Docker)

```bash
pnpm install
make up                 # or run just the datastores you need
pnpm migrate && pnpm seed:admin
pnpm dev                # web on :3000
pnpm dev:worker         # worker (separate terminal)
```

In development with no Resend key, the **sign-in code is printed to the worker/web
console** so you can complete the flow without sending email. With no Turnstile
key, the captcha is bypassed (dev only — production refuses to boot without both
the Turnstile and Safe Browsing keys).

---

## `.env` walkthrough

`.env.example` documents every variable inline. Highlights:

- `SESSION_SECRET` — 64 random bytes (hex); signs the session JWT.
- `POSTGRES_*` must match `DATABASE_URL`; `MINIO_ROOT_*` feed both MinIO and the
  app's `S3_*`.
- `TURNSTILE_*`, `GSB_API_KEY` — **required in production** (validated at boot).
- `RATE_LIMIT_*` — override the in-code defaults.
- `GEOIP_DIR` / `MAXMIND_LICENSE_KEY` — geo is best-effort; absent files → country `ZZ`.
- `INITIAL_ADMIN_EMAIL` — used by `pnpm seed:admin`.
- `ABBREFY_EXPORT_PATH` — JSON file for the one-shot user import.

No secrets live in the repo. Never commit a filled-in `.env`.

---

## Common operations

| Task | Command |
|---|---|
| Apply migrations | `make migrate` (or `pnpm migrate`) |
| Create a migration after schema edits | `pnpm migrate:create` |
| Add / promote an admin | set `INITIAL_ADMIN_EMAIL`, then `make seed` |
| Import abbrefy users | put JSON at `ABBREFY_EXPORT_PATH`, then `make import-abbrefy` |
| Open psql / redis-cli / clickhouse | `make psql` · `make redis-cli` · `make ch-client` |
| Benchmark the redirect path | `scripts/bench-redirect.sh <code>` (needs `oha` or `bombardier`) |
| Typecheck / lint / test | `pnpm typecheck` · `pnpm lint` · `pnpm test` |

### Adding an admin

`pnpm seed:admin` creates or promotes the user in `INITIAL_ADMIN_EMAIL` to the
`admin` role (idempotent). They then sign in normally at `/signin`. Existing
admins can change roles from `/admin/users` (admin-only).

### Importing abbrefy users

The old platform exports a JSON array of `{ email, legacy_id, created_at }`. Place
it at `ABBREFY_EXPORT_PATH` and run `make import-abbrefy`. It's idempotent and
imports **users only** (links are out of scope). Afterwards, a returning user who
enters their email at `/signin` is recognized and signed in seamlessly (§11).

---

## Backups & restore

Daily backups are recommended (cron on the host, or a sidecar container).

```bash
make backup                                  # gzip pg_dump + mirror MinIO into ./backups/<stamp>/
make restore FILE=backups/<stamp>/postgres.sql.gz
```

For production, also schedule off-box copies. ClickHouse click data is replaceable
analytics; prioritize Postgres (the source of truth) and MinIO. Manual equivalents:

```bash
# Postgres
docker compose -f infra/docker-compose.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > pg.sql.gz
# MinIO (using mc against the running service)
mc mirror --overwrite local/clipal ./minio-backup
```

---

## Security posture (Phase 1)

Submission-time URL validation (scheme, SSRF/IP-literal/internal-host rejection,
blocklist, known-shortener refusal, Safe Browsing); Redis sliding-window rate
limits; Turnstile on anon shorten + signin + verify; argon2id codes; HS256 JWT
sessions with a Redis revocation denylist; strict CSP with per-request nonce
(middleware) + uniform headers (Caddy + Next); parameterized queries everywhere;
salted, daily-rotating IP hashes (never raw IPs in analytics); RBAC + an
append-only audit log on every admin mutation. Full checklist in `§14` of the
spec.

---

## Open questions

Some decisions need the owner (legal copy, brand-term policy, MaxMind key, etc.).
They're collected in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) and mirrored as
`TODO(@owner)` comments in code. **The legal pages are placeholder drafts — have
them reviewed before launch.**

---

## License

Proprietary — © clip.al. (TODO(@owner): confirm license.)
