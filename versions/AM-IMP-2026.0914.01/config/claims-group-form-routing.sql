BEGIN;

CREATE TABLE IF NOT EXISTS am_claims.group_form_configs (
  tenant_id UUID NOT NULL,
  group_lookup CHAR(64) NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by TEXT,
  PRIMARY KEY (tenant_id,group_lookup),
  FOREIGN KEY (tenant_id,group_lookup) REFERENCES am_claims.groups(tenant_id,group_lookup)
);

CREATE TABLE IF NOT EXISTS am_claims.group_forms (
  tenant_id UUID NOT NULL,
  group_lookup CHAR(64) NOT NULL,
  form_key TEXT NOT NULL CHECK (form_key IN ('legacy_social_insurance','legacy_shared_operating','legacy_other','employee_expense')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by TEXT,
  PRIMARY KEY (tenant_id,group_lookup,form_key),
  FOREIGN KEY (tenant_id,group_lookup) REFERENCES am_claims.group_form_configs(tenant_id,group_lookup) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS am_claims.form_selection_sessions (
  tenant_id UUID NOT NULL,
  session_id UUID NOT NULL,
  group_lookup CHAR(64) NOT NULL,
  member_lookup CHAR(64) NOT NULL,
  event_key CHAR(64) NOT NULL,
  available_form_keys JSONB NOT NULL,
  selected_form_key TEXT,
  resolved_url TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  selected_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id,session_id),
  UNIQUE (tenant_id,event_key),
  FOREIGN KEY (tenant_id,group_lookup) REFERENCES am_claims.groups(tenant_id,group_lookup),
  FOREIGN KEY (tenant_id,group_lookup,member_lookup) REFERENCES am_claims.members(tenant_id,group_lookup,member_lookup),
  CHECK (jsonb_typeof(available_form_keys) = 'array'),
  CHECK (selected_form_key IS NULL OR selected_form_key IN ('legacy_social_insurance','legacy_shared_operating','legacy_other','employee_expense'))
);

CREATE INDEX IF NOT EXISTS claims_group_forms_form_idx ON am_claims.group_forms(tenant_id,form_key,sort_order,group_lookup);
CREATE INDEX IF NOT EXISTS claims_form_sessions_expiry_idx ON am_claims.form_selection_sessions(tenant_id,expires_at);

ALTER TABLE am_claims.group_form_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE am_claims.group_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE am_claims.form_selection_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE am_claims.group_form_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE am_claims.group_forms FORCE ROW LEVEL SECURITY;
ALTER TABLE am_claims.form_selection_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS claims_group_form_configs_tenant ON am_claims.group_form_configs;
DROP POLICY IF EXISTS claims_group_forms_tenant ON am_claims.group_forms;
DROP POLICY IF EXISTS claims_form_sessions_tenant ON am_claims.form_selection_sessions;
CREATE POLICY claims_group_form_configs_tenant ON am_claims.group_form_configs TO am_claims_tenant
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY claims_group_forms_tenant ON am_claims.group_forms TO am_claims_tenant
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY claims_form_sessions_tenant ON am_claims.form_selection_sessions TO am_claims_tenant
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);

REVOKE ALL ON am_claims.group_form_configs,am_claims.group_forms,am_claims.form_selection_sessions FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON am_claims.group_form_configs,am_claims.group_forms TO am_claims_tenant;
GRANT SELECT,INSERT,UPDATE,DELETE ON am_claims.form_selection_sessions TO am_claims_tenant;
GRANT SELECT ON am_claims.group_form_configs,am_claims.group_forms,am_claims.form_selection_sessions TO am_claims_platform_owner,am_claims_auditor;

COMMIT;
