-- MyAmpix ClickHouse schema.
-- Source of truth: docs/superpowers/specs/2026-07-02-shared-contracts.md §5.
-- Runs once on first container start via /docker-entrypoint-initdb.d/.
-- Idempotent (IF NOT EXISTS) so it is safe to re-run manually.

-- ClickHouse 24.8 gates the JSON column type behind this flag.
SET allow_experimental_json_type = 1;

CREATE DATABASE IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.events (
  project_id    UUID,
  insert_id     UUID,
  event         LowCardinality(String) CODEC(ZSTD(3)),
  distinct_id   String CODEC(ZSTD(3)),
  anon_id       String CODEC(ZSTD(3)),
  session_id    UUID,
  timestamp     DateTime64(3, 'UTC') CODEC(Delta, ZSTD(3)),
  server_timestamp DateTime64(3, 'UTC') CODEC(Delta, ZSTD(3)),
  properties    JSON,
  app_version   LowCardinality(String), app_build LowCardinality(String),
  os            LowCardinality(String), os_version LowCardinality(String),
  device_model  LowCardinality(String), device_manufacturer LowCardinality(String),
  locale        LowCardinality(String), timezone LowCardinality(String),
  screen_width  UInt16, screen_height UInt16,
  network       LowCardinality(String), sdk_version LowCardinality(String),
  utm_source    LowCardinality(String), utm_medium LowCardinality(String),
  utm_campaign  String, utm_content String, utm_term String,
  first_utm_source LowCardinality(String), first_utm_campaign String,
  install_referrer String CODEC(ZSTD(3))
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, event, timestamp, insert_id);

CREATE TABLE IF NOT EXISTS analytics.user_profiles (
  project_id UUID, distinct_id String,
  properties JSON, updated_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (project_id, distinct_id);

CREATE TABLE IF NOT EXISTS analytics.identity_mappings (
  project_id UUID, anon_id String, canonical_id String,
  created_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(created_at)
ORDER BY (project_id, anon_id);

-- Identity resolution (contracts §17). The SDK emits a reserved `$identify` event on identify():
-- its `distinct_id` is the new (post-login) user id and it carries property `$anon_id` = the
-- pre-login anonymous id. This MV projects those links into `analytics.identity_mappings` so the
-- read side can merge an anonymous user with their identified self (anon_id -> canonical_id).
-- `$identify` / `$anon_id` are OUR fixed reserved constants (contracts §4/§17), embedded as SQL
-- literals here — never bound from user input — exactly as `$session_end` / `$duration_ms` are in
-- `daily_sessions_mv`. `toJSONString(properties)` is required because `properties` is the native
-- JSON type, not a String column (verified against clickhouse-server:24.8). Rows whose `$anon_id`
-- is empty are skipped (no link to record).
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.identity_mappings_mv
TO analytics.identity_mappings
AS
SELECT
  project_id,
  JSONExtractString(toJSONString(properties), '$anon_id') AS anon_id,
  distinct_id AS canonical_id,
  timestamp AS created_at
FROM analytics.events
WHERE event = '$identify'
  AND JSONExtractString(toJSONString(properties), '$anon_id') != '';

-- Phase 3 rollup materialized views (contracts §14). Fed continuously from `analytics.events` as
-- new rows land. Correctness note (contracts §14): the Phase 3 insights/meta endpoints
-- intentionally query RAW events for exact, `DISTINCT insert_id`-deduplicated results — these
-- rollups exist purely as a future dashboard-speed optimization and are not read by any endpoint
-- yet.

-- Daily active users: AggregatingMergeTree storing a mergeable uniq() state per (project_id, day).
CREATE TABLE IF NOT EXISTS analytics.daily_active_users
(
  project_id  UUID,
  day         Date,
  users_state AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (project_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.daily_active_users_mv
TO analytics.daily_active_users
AS
SELECT
  project_id,
  toDate(timestamp) AS day,
  uniqState(distinct_id) AS users_state
FROM analytics.events
GROUP BY project_id, day;

-- Daily event counts: SummingMergeTree keyed by (project_id, day, event) — `count` sums across merges.
-- NOTE: no comment or statement below may contain a literal semicolon character anywhere (not even
-- inside backticks) — both the production container's init and the test suite's
-- applyClickHouseSchema() naively split this whole file on that character.
CREATE TABLE IF NOT EXISTS analytics.daily_event_counts
(
  project_id UUID,
  day        Date,
  event      LowCardinality(String),
  count      UInt64
)
ENGINE = SummingMergeTree(count)
ORDER BY (project_id, day, event);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.daily_event_counts_mv
TO analytics.daily_event_counts
AS
SELECT
  project_id,
  toDate(timestamp) AS day,
  event,
  count() AS count
FROM analytics.events
GROUP BY project_id, day, event;

-- Daily sessions: SummingMergeTree keyed by (project_id, day) — derived from `$session_end` events,
-- whose `$duration_ms` property carries the exact session duration. `toJSONString(properties)` is
-- required because `properties` is the native `JSON` type, not a `String` column holding JSON
-- text — `JSONExtractUInt` needs a `String` argument (verified against clickhouse-server:24.8).
CREATE TABLE IF NOT EXISTS analytics.daily_sessions
(
  project_id        UUID,
  day               Date,
  sessions          UInt64,
  total_duration_ms UInt64
)
ENGINE = SummingMergeTree((sessions, total_duration_ms))
ORDER BY (project_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.daily_sessions_mv
TO analytics.daily_sessions
AS
SELECT
  project_id,
  toDate(timestamp) AS day,
  count() AS sessions,
  sum(JSONExtractUInt(toJSONString(properties), '$duration_ms')) AS total_duration_ms
FROM analytics.events
WHERE event = '$session_end'
GROUP BY project_id, day;
