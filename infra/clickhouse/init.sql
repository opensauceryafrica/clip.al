-- clip.al — ClickHouse schema
-- Mounted at /docker-entrypoint-initdb.d/ and run once on first container init.
-- ClickHouse is the only store that sanely holds billions of click rows.

CREATE DATABASE IF NOT EXISTS clipal;

-- ---------------------------------------------------------------------------
-- Raw click events. One row per redirect. Partitioned by month, ordered by
-- (link_code, ts) so per-link time-range scans hit a contiguous range.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clipal.clicks
(
  ts              DateTime64(3, 'UTC'),
  link_code       LowCardinality(String),
  link_id         UUID,
  owner_id        Nullable(UUID),
  ip_hash         FixedString(64),          -- sha256(ip + daily_salt) hex; dedupe today, unlinkable historically
                                            -- (64 hex chars = the 32-byte digest; the prompt's FixedString(32) can't hold hex)
  country         LowCardinality(String),
  region          LowCardinality(String),
  city            String,
  ua_family       LowCardinality(String),
  ua_os           LowCardinality(String),
  device          LowCardinality(String),   -- 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown'
  referrer_host   LowCardinality(String),
  is_bot          UInt8,
  is_interstitial UInt8,                     -- 1 if served via /p, 0 if direct /r
  utm_source      LowCardinality(String),
  utm_medium      LowCardinality(String),
  utm_campaign    LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (link_code, ts)
TTL toDateTime(ts) + INTERVAL 3 YEAR;       -- adjust later; guards against unbounded growth

-- ---------------------------------------------------------------------------
-- Daily per-link rollup, kept hot for the dashboard.
--
-- NOTE (deviation from the prompt's literal DDL, on purpose): the prompt wrote
-- this as a SummingMergeTree populated by `... AS SELECT`. A SummingMergeTree
-- cannot merge an AggregateFunction(uniqExact) state correctly, and `AS SELECT`
-- only back-fills once. The correct ClickHouse pattern is an AggregatingMergeTree
-- target table fed by an incremental MATERIALIZED VIEW:
--   * `clicks` is a SimpleAggregateFunction(sum) so partial daily counts merge.
--   * `unique_visitors_state` is an AggregateFunction(uniqExact) state.
-- Query with sum(clicks) and uniqExactMerge(unique_visitors_state).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clipal.clicks_per_link_daily
(
  link_code             String,
  day                   Date,
  clicks                SimpleAggregateFunction(sum, UInt64),
  unique_visitors_state AggregateFunction(uniqExact, FixedString(64))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (link_code, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS clipal.clicks_per_link_daily_mv
TO clipal.clicks_per_link_daily
AS SELECT
  link_code,
  toDate(ts)                  AS day,
  count()                     AS clicks,
  uniqExactState(ip_hash)     AS unique_visitors_state
FROM clipal.clicks
GROUP BY link_code, day;
