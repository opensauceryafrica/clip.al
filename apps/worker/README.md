# @clipal/worker

Background worker (§18). One process, several async loops with clean boundaries
so any can later be split into its own container:

- **Click ingest** — drains the Redis `clicks` stream (consumer group `clicks-cg`),
  parses UA, tags bots, geo-locates (MaxMind GeoLite2), hashes the IP with a
  rotating daily salt, batch-inserts to ClickHouse, then updates the denormalized
  `links.clicks_total` per code. XACKs only after a successful insert; 3 failures
  route a message to the `clicks:dlq` dead-letter stream.
- **URL re-scan** — every minute, re-checks up to 500 stale links via Google Safe
  Browsing; disables and notifies on newly-malicious ones.
- **Reapers** — auth-code reaper (5 min) and session reaper (daily).
- **Salt rotator** — keeps the current UTC-day IP-hash salt warm.
- **Account purge** — daily; hard-deletes accounts soft-deleted longer than
  `ACCOUNT_PURGE_GRACE_DAYS` (default 30), cascading to their data.
- **GeoLite2 refresh** — startup + weekly; downloads/verifies the MaxMind
  databases when `MAXMIND_LICENSE_KEY` is set (otherwise skipped).

A liveness HTTP endpoint runs on `WORKER_HEALTH_PORT` (default 9090) for the
container healthcheck.

**GeoLite2:** the databases live in `GEOIP_DIR`. Geo is best-effort — if the file
is missing, ingest continues with `country=ZZ`. With a `MAXMIND_LICENSE_KEY` set
(free with a MaxMind account), the geo-refresh job downloads + sha256-verifies
them at startup and weekly; without it, supply the `.mmdb` files manually.
Editions are configurable via `MAXMIND_EDITION_IDS` (default `GeoLite2-City`).

**Scaling:** the click consumer uses a single consumer group. To scale, run more
worker replicas with distinct consumer names — Redis streams distribute pending
entries across consumers in the group.
