CREATE SCHEMA IF NOT EXISTS leaf_calendar;
CREATE TABLE IF NOT EXISTS leaf_calendar.pairings (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id),
  code_hash text NOT NULL,
  base_url text NOT NULL,
  encrypted_key jsonb NOT NULL,
  fingerprint text NOT NULL,
  expires_at timestamptz NOT NULL,
  claimed_by text,
  PRIMARY KEY (tenant_id, code_hash)
);
CREATE TABLE IF NOT EXISTS leaf_calendar.bindings (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id),
  line_user_id text NOT NULL,
  base_url text NOT NULL,
  encrypted_key jsonb NOT NULL,
  fingerprint text NOT NULL,
  editing_id text,
  editing_revision integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, line_user_id),
  UNIQUE (tenant_id, fingerprint)
);
CREATE TABLE IF NOT EXISTS leaf_calendar.requests (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id),
  request_id text NOT NULL,
  line_user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('intake','draft','control','notice')),
  status text NOT NULL CHECK (status IN ('queued','pending','needs_details','confirmed','saving','saved','cancelled','failed','expired','notice','done')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_evidence jsonb NOT NULL,
  fingerprint text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  prompted_revision integer NOT NULL DEFAULT 0,
  notified boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  result jsonb,
  error_code text,
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_id),
  CHECK (status NOT IN ('confirmed','saving','saved') OR (kind='draft' AND confirmed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS leaf_calendar_queue ON leaf_calendar.requests(tenant_id,status,available_at);
ALTER TABLE leaf_calendar.pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaf_calendar.pairings FORCE ROW LEVEL SECURITY;
ALTER TABLE leaf_calendar.bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaf_calendar.bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE leaf_calendar.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaf_calendar.requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON leaf_calendar.pairings;
CREATE POLICY tenant_isolation ON leaf_calendar.pairings USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
DROP POLICY IF EXISTS tenant_isolation ON leaf_calendar.bindings;
CREATE POLICY tenant_isolation ON leaf_calendar.bindings USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
DROP POLICY IF EXISTS tenant_isolation ON leaf_calendar.requests;
CREATE POLICY tenant_isolation ON leaf_calendar.requests USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
