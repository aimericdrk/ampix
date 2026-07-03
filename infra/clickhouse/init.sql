-- MyAmpMix ClickHouse schema.
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
