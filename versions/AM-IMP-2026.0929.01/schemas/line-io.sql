-- Run once in the deployment-owned database; never import real rows into AMCore.
BEGIN;
CREATE SCHEMA IF NOT EXISTS line_io;
SELECT pg_advisory_xact_lock(9282026, 2);
CREATE TABLE IF NOT EXISTS line_io.line_io_events (
  seq bigserial PRIMARY KEY,
  tenant_key text NOT NULL,
  group_id text NOT NULL,
  event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  UNIQUE (tenant_key, event_id)
);
CREATE INDEX IF NOT EXISTS line_io_events_scope ON line_io.line_io_events (tenant_key, group_id, seq);
CREATE TABLE IF NOT EXISTS line_io.line_io_unsent (
  tenant_key text NOT NULL,
  group_id text NOT NULL,
  message_id text NOT NULL,
  PRIMARY KEY (tenant_key, group_id, message_id)
);
CREATE TABLE IF NOT EXISTS line_io.line_io_sends (
  tenant_key text NOT NULL,
  client_id text NOT NULL,
  idempotency_key text NOT NULL,
  body_hash text NOT NULL,
  retry_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  attempt uuid,
  result jsonb,
  PRIMARY KEY (tenant_key, client_id, idempotency_key)
);
COMMIT;
