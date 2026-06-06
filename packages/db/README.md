# @clipal/db

Drizzle schema (Postgres 16), the typed client, and the migrator. Source of
truth for every table in §7: `users`, `auth_codes`, `sessions`, `links`,
`link_reports`, `blocked_domains`, `reserved_slugs`, `audit_log`,
`abbrefy_migrations`, `flagged_brand_terms`. `email` columns use `citext`; IPs
use `inet`. `recordAudit` is the only (append-only) write path for `audit_log`.

- Generate a migration after editing schema: `pnpm --filter @clipal/db generate`
- Apply migrations: `pnpm --filter @clipal/db migrate` (creates the `citext`
  extension first, then runs Drizzle migrations).

The redirect hot path intentionally does **not** import this package; it uses a
minimal raw `postgres` pool (see `apps/web/app/r/[code]/route.ts`).
