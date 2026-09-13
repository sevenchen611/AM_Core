BEGIN;

CREATE SCHEMA IF NOT EXISTS am_claims;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'am_claims_tenant') THEN CREATE ROLE am_claims_tenant NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'am_claims_discovery_writer') THEN CREATE ROLE am_claims_discovery_writer NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'am_claims_platform_owner') THEN CREATE ROLE am_claims_platform_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'am_claims_worker') THEN CREATE ROLE am_claims_worker NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'am_claims_auditor') THEN CREATE ROLE am_claims_auditor NOLOGIN; END IF;
END
$roles$;

CREATE TABLE IF NOT EXISTS am_claims.discovered_groups (
  group_lookup CHAR(64) PRIMARY KEY,
  group_ciphertext TEXT NOT NULL,
  group_name_ciphertext TEXT,
  key_id TEXT NOT NULL DEFAULT 'fixed-v1' CHECK (key_id = 'fixed-v1'),
  state TEXT NOT NULL CHECK (state IN ('unassigned','activating','active','paused','needs_attention')),
  oa_state TEXT NOT NULL CHECK (oa_state IN ('present','left')),
  assigned_tenant_id UUID,
  assigned_group_lookup CHAR(64),
  last_event_key CHAR(64),
  last_error TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS am_claims.groups (
  tenant_id UUID NOT NULL,
  group_lookup CHAR(64) NOT NULL,
  group_ciphertext TEXT NOT NULL,
  group_name_ciphertext TEXT,
  binding_lookup CHAR(64),
  binding_ciphertext TEXT,
  key_id TEXT NOT NULL DEFAULT 'fixed-v1' CHECK (key_id = 'fixed-v1'),
  state TEXT NOT NULL CHECK (state IN ('unassigned','activating','active','paused','needs_attention')),
  oa_state TEXT NOT NULL CHECK (oa_state IN ('present','left')),
  finance_source_ref TEXT,
  finance_form_key TEXT,
  finance_group_reference TEXT,
  last_error TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,group_lookup)
);

CREATE TABLE IF NOT EXISTS am_claims.members (
  tenant_id UUID NOT NULL,
  group_lookup CHAR(64) NOT NULL,
  member_lookup CHAR(64) NOT NULL,
  member_ciphertext TEXT NOT NULL,
  member_name_ciphertext TEXT,
  key_id TEXT NOT NULL DEFAULT 'fixed-v1' CHECK (key_id = 'fixed-v1'),
  state TEXT NOT NULL CHECK (state IN ('observed','left')),
  manual_deny BOOLEAN NOT NULL DEFAULT false,
  first_observed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,group_lookup,member_lookup),
  FOREIGN KEY (tenant_id,group_lookup) REFERENCES am_claims.groups(tenant_id,group_lookup)
);

CREATE TABLE IF NOT EXISTS am_claims.events (
  tenant_id UUID NOT NULL,
  event_key CHAR(64) NOT NULL,
  event_type TEXT NOT NULL,
  group_lookup CHAR(64) NOT NULL,
  member_lookup CHAR(64),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,event_key)
);

CREATE TABLE IF NOT EXISTS am_claims.outbox (
  tenant_id UUID NOT NULL,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  group_lookup CHAR(64) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retry','sent','dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id,event_key)
);

CREATE TABLE IF NOT EXISTS am_claims.audit (
  audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id UUID NOT NULL,
  action TEXT NOT NULL,
  subject_lookup CHAR(64),
  actor_subject TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS claims_discovered_state_idx ON am_claims.discovered_groups(state,updated_at DESC);
CREATE INDEX IF NOT EXISTS claims_groups_state_idx ON am_claims.groups(tenant_id,state,updated_at DESC);
CREATE INDEX IF NOT EXISTS claims_members_group_idx ON am_claims.members(tenant_id,group_lookup,updated_at DESC);
CREATE INDEX IF NOT EXISTS claims_outbox_ready_idx ON am_claims.outbox(status,available_at,created_at) WHERE status IN ('pending','retry');
CREATE INDEX IF NOT EXISTS claims_outbox_lease_idx ON am_claims.outbox(lease_expires_at) WHERE status = 'processing';

ALTER TABLE am_claims.groups ADD COLUMN IF NOT EXISTS key_id TEXT NOT NULL DEFAULT 'fixed-v1';
ALTER TABLE am_claims.discovered_groups ADD COLUMN IF NOT EXISTS group_name_ciphertext TEXT;
ALTER TABLE am_claims.groups ADD COLUMN IF NOT EXISTS group_name_ciphertext TEXT;
ALTER TABLE am_claims.groups ADD COLUMN IF NOT EXISTS finance_form_key TEXT;
ALTER TABLE am_claims.groups ADD COLUMN IF NOT EXISTS finance_group_reference TEXT;
ALTER TABLE am_claims.members ADD COLUMN IF NOT EXISTS key_id TEXT NOT NULL DEFAULT 'fixed-v1';
ALTER TABLE am_claims.members ADD COLUMN IF NOT EXISTS member_name_ciphertext TEXT;
ALTER TABLE am_claims.outbox ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE am_claims.outbox ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE am_claims.outbox ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE am_claims.outbox ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE am_claims.outbox ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE am_claims.outbox ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claims_groups_fixed_key') THEN
    ALTER TABLE am_claims.groups ADD CONSTRAINT claims_groups_fixed_key CHECK (key_id = 'fixed-v1');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claims_members_fixed_key') THEN
    ALTER TABLE am_claims.members ADD CONSTRAINT claims_members_fixed_key CHECK (key_id = 'fixed-v1');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claims_outbox_status') THEN
    ALTER TABLE am_claims.outbox ADD CONSTRAINT claims_outbox_status CHECK (status IN ('pending','processing','retry','sent','dead'));
  END IF;
END
$constraints$;

ALTER TABLE am_claims.discovered_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE am_claims.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE am_claims.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE am_claims.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE am_claims.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE am_claims.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE am_claims.discovered_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE am_claims.groups FORCE ROW LEVEL SECURITY;
ALTER TABLE am_claims.members FORCE ROW LEVEL SECURITY;
ALTER TABLE am_claims.events FORCE ROW LEVEL SECURITY;
ALTER TABLE am_claims.outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE am_claims.audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS claims_discovery_write ON am_claims.discovered_groups;
DROP POLICY IF EXISTS claims_discovery_admin ON am_claims.discovered_groups;
DROP POLICY IF EXISTS claims_groups_tenant ON am_claims.groups;
DROP POLICY IF EXISTS claims_members_tenant ON am_claims.members;
DROP POLICY IF EXISTS claims_events_tenant ON am_claims.events;
DROP POLICY IF EXISTS claims_outbox_tenant ON am_claims.outbox;
DROP POLICY IF EXISTS claims_outbox_worker ON am_claims.outbox;
DROP POLICY IF EXISTS claims_audit_tenant ON am_claims.audit;
DROP POLICY IF EXISTS claims_audit_admin ON am_claims.audit;

CREATE POLICY claims_discovery_write ON am_claims.discovered_groups FOR ALL TO am_claims_discovery_writer USING (true) WITH CHECK (true);
CREATE POLICY claims_discovery_admin ON am_claims.discovered_groups FOR ALL TO am_claims_platform_owner USING (true) WITH CHECK (true);
CREATE POLICY claims_groups_tenant ON am_claims.groups TO am_claims_tenant
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY claims_members_tenant ON am_claims.members TO am_claims_tenant
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY claims_events_tenant ON am_claims.events TO am_claims_tenant
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY claims_outbox_tenant ON am_claims.outbox TO am_claims_tenant
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY claims_outbox_worker ON am_claims.outbox FOR ALL TO am_claims_worker USING (true) WITH CHECK (true);
CREATE POLICY claims_audit_tenant ON am_claims.audit TO am_claims_tenant
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY claims_audit_admin ON am_claims.audit FOR SELECT TO am_claims_platform_owner,am_claims_auditor USING (true);

REVOKE ALL ON ALL TABLES IN SCHEMA am_claims FROM PUBLIC;
GRANT USAGE ON SCHEMA am_claims TO am_claims_tenant,am_claims_discovery_writer,am_claims_platform_owner,am_claims_worker,am_claims_auditor;
GRANT SELECT,INSERT,UPDATE ON am_claims.groups,am_claims.members,am_claims.outbox TO am_claims_tenant;
GRANT SELECT,INSERT ON am_claims.events,am_claims.audit TO am_claims_tenant;
GRANT SELECT,INSERT,UPDATE ON am_claims.discovered_groups TO am_claims_discovery_writer,am_claims_platform_owner;
GRANT SELECT ON am_claims.groups,am_claims.members,am_claims.audit TO am_claims_platform_owner,am_claims_auditor;
GRANT SELECT,UPDATE ON am_claims.outbox TO am_claims_worker;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA am_claims TO am_claims_tenant,am_claims_platform_owner;

COMMIT;
