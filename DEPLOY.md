# Deploying clip.al

clip.al ships as a self-contained Docker Compose stack fronted by **Caddy**
(automatic HTTPS via Let's Encrypt). This guide takes you from a bare server to a
running production deployment.

The repo's `Makefile` wraps the common commands — run `make help` to list them.

---

## 1. Prerequisites

- A **Linux server / VPS** with **Docker** and the **Docker Compose v2** plugin
  installed. ~2–4 GB RAM is enough to start (Postgres + Redis + ClickHouse +
  MinIO + 2× web + worker + Caddy).
- A **domain** you control, with a DNS **A record** pointing at the server's
  public IP. (Add `AAAA` for IPv6 if relevant.)
- Inbound ports **80** and **443** open. Caddy provisions and renews TLS certs
  automatically once DNS resolves and the ports are reachable.
- Accounts / API keys for the external services (see [§4](#4-external-services)).
  Some are **hard requirements** — the app refuses to boot in production without
  them.

---

## 2. Get the code

```bash
git clone git@github.com:opensauceryafrica/clip.al.git
cd clip.al
git checkout main
```

---

## 3. Configure `.env`

```bash
cp .env.example .env
```

`.env` is gitignored — never commit it. Fill in real values. The variables that
matter most for production:

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | Your public origin, e.g. `https://links.example.com`. **All** public URLs and cookies derive from this, never the request host. |
| `COOKIE_DOMAIN` | The apex/host the session cookie is scoped to (e.g. `example.com`). Must match `APP_URL`'s host (or be a parent of it). |
| `SESSION_SECRET` | 64+ hex chars. Generate: `openssl rand -hex 64`. |
| `POSTGRES_PASSWORD`, `DATABASE_URL` | Strong password; keep them in sync. |
| `MINIO_ROOT_PASSWORD` | Strong password. |
| `CLICKHOUSE_PASSWORD` | Strong password. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile (CAPTCHA). **The secret is required in production — the app won't boot without it.** |
| `GSB_API_KEY` | Google Safe Browsing v4 key. **Also required in production.** |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend key + a sender on a **verified domain** (see §4). Without working email, no one can sign up or log in. |
| `INITIAL_ADMIN_EMAIL` | The first admin account (created/promoted by `make seed`). |
| `MAXMIND_LICENSE_KEY` | Optional. Free with a MaxMind account; enables geo. Without it analytics show `country=ZZ` and the worker logs the disabled state at boot. |

> Security note: in production the config layer **fails fast at boot** if
> `SESSION_SECRET`, `TURNSTILE_SECRET_KEY`, or `GSB_API_KEY` are missing/weak.
> That's intentional — fix the env rather than working around it.

---

## 4. External services

| Service | Why | Required? |
| --- | --- | --- |
| **Resend** (email) | Sends the 6-digit sign-in/sign-up codes. Verify a sending domain at <https://resend.com/domains> and set `EMAIL_FROM` to an address on it. The sandbox sender (`onboarding@resend.dev`) only delivers to your own verified address — useless for real users. | **Yes** (auth depends on it) |
| **Cloudflare Turnstile** | CAPTCHA on anonymous shorten + sign-in + verify. | **Yes** in prod |
| **Google Safe Browsing** | Scans destinations at submission and on the rolling re-scan. | **Yes** in prod |
| **MaxMind GeoLite2** | Geo analytics. The worker auto-downloads + verifies the DBs at startup and weekly when `MAXMIND_LICENSE_KEY` is set. | Optional |

---

## 5. Point Caddy at your domain

Edit `infra/Caddyfile`:

- Replace the site address `clip.al, *.clip.al` with **your** domain. For a
  single apex/host, just use `links.example.com` and **drop the `*.` wildcard** —
  wildcard certs need a DNS-01 challenge (a Phase 2 concern for custom
  subdomains; see the commented `tls { dns ... }` block).
- Change `email admin@clip.al` to your ops email (used for Let's Encrypt).

Caddy already forwards the real client IP (`X-Real-IP` / `X-Forwarded-For`),
which the redirect hot path, rate limiting, and analytics rely on — leave that
block as-is.

> For staging, uncomment the `acme_ca …staging…` line in the Caddyfile so you
> don't burn Let's Encrypt rate limits while testing.

---

## 6. Build and start

The production overlay (`infra/docker-compose.prod.yml`) adds log rotation,
memory limits, and runs **2 web replicas** (Caddy load-balances them).

```bash
make up-prod
# equivalent to:
# docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
#   --env-file .env up -d --build
```

First boot pulls images, builds the `web` and `worker` images, runs the
datastores' health checks, and starts everything in dependency order.

---

## 7. Migrate the database and seed the admin

```bash
make migrate    # applies Drizzle migrations (0000 → latest) on the fresh DB
make seed       # creates/promotes INITIAL_ADMIN_EMAIL to an admin
make health     # should print an OK status
```

Then open `https://yourdomain` — Caddy issues the certificate on the first
request (allow a few seconds).

Sign in as the admin: go to `/signin`, enter `INITIAL_ADMIN_EMAIL`, and use the
code from your inbox (delivery must be working — see §4).

---

## 8. Day-2 operations

```bash
make ps                 # service status
make logs               # tail all logs   (make logs S=web to scope to one)
make restart S=web      # restart a single service
make psql               # psql shell on the app DB
make redis-cli          # redis-cli
make ch-client          # ClickHouse client
make down               # stop the stack (keeps volumes/data)
```

### Backups

```bash
make backup             # gzip pg_dump + mirror MinIO into ./backups/<timestamp>/
make restore FILE=backups/<timestamp>/postgres.sql.gz
```

Schedule `make backup` via cron and **copy the output off-box**. Postgres is the
source of truth and MinIO holds object data; ClickHouse click data is replaceable
analytics, so prioritize the first two.

### Updating to a new release

```bash
git pull
make up-prod            # rebuilds changed images and restarts
make migrate            # if the release added migrations
```

### Scaling

- The **redirect hot path** scales horizontally — bump `web` `replicas` in the
  prod overlay; Caddy load-balances automatically.
- The **worker** uses a single Redis consumer group. To scale consumers, run more
  worker replicas with distinct consumer names — see `apps/worker/README.md`.

---

## 9. Pre-launch checklist

- [ ] **Email delivery works** — Resend domain verified, `EMAIL_FROM` set, a test
      sign-up/login actually receives a code. *Until this is done, no one can sign
      up or log in.*
- [ ] **Real Turnstile + GSB keys** in `.env` (the app won't boot in prod
      without them).
- [ ] **Legal pages reviewed** — TOS / Privacy / AUP / DMCA ship as defensible
      *placeholders*; have counsel replace them. See `OPEN_QUESTIONS.md`.
- [ ] **Abuse lists confirmed** — review the blocklist (domains + keywords) and
      reserved slugs for your market (admin → Blocklist).
- [ ] **`SESSION_SECRET` is unique and strong**, DB/MinIO passwords changed from
      defaults.
- [ ] **Backups scheduled** and verified by a test restore.
- [ ] **DNS + TLS** resolve and the cert issued (`make health` over HTTPS).

---

## Notes & gotchas

- **Fresh DB vs. existing.** On a brand-new database, `make migrate` applies every
  migration cleanly. (If you ever bootstrap a DB with `make migrate-push` instead,
  the migration journal and the DB can diverge — stick to `make migrate` in prod.)
- **Build-time `APP_URL`.** The web image bakes `APP_URL` at build time for a
  couple of static SEO files (`robots.txt`, Open Graph tags). The dynamic
  `sitemap.xml` and all redirects use the **runtime** `APP_URL`, so the app works
  regardless — but rebuild with your domain's `APP_URL` if you care about those
  static tags.
- **Observability (optional).** `make up-obs` adds a self-hosted GlitchTip
  (Sentry-compatible) overlay; set `SENTRY_DSN` to capture server errors. Without
  a DSN, error tracking is a no-op and the app logs one `[boot]` line saying so.
- **Wildcard subdomains** (`*.yourdomain`) are a Phase 2 feature and need a DNS-01
  challenge (e.g. the Cloudflare plugin) — not required for launch.

See also: `README.md` (architecture + `.env` walkthrough) and
`OPEN_QUESTIONS.md` (owner decisions still pending).
