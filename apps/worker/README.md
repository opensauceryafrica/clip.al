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

A liveness HTTP endpoint runs on `WORKER_HEALTH_PORT` (default 9090) for the
container healthcheck.

**GeoLite2:** mount `GeoLite2-City.mmdb` in `GEOIP_DIR`. Geo is best-effort — if
the file is missing, ingest continues with `country=ZZ`. Refresh monthly (needs a
`MAXMIND_LICENSE_KEY`; see OPEN_QUESTIONS.md).

**Scaling:** the click consumer uses a single consumer group. To scale, run more
worker replicas with distinct consumer names — Redis streams distribute pending
entries across consumers in the group.
