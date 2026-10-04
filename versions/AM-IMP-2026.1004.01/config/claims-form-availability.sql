BEGIN;
CREATE TABLE IF NOT EXISTS am_claims.form_availability (
 tenant_id UUID NOT NULL,form_key TEXT NOT NULL CHECK(form_key IN ('legacy_social_insurance','legacy_shared_operating','legacy_other','employee_expense')),
 enabled BOOLEAN NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_by TEXT,PRIMARY KEY(tenant_id,form_key)
);
ALTER TABLE am_claims.form_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE am_claims.form_availability FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS claims_form_availability_tenant ON am_claims.form_availability;
CREATE POLICY claims_form_availability_tenant ON am_claims.form_availability TO am_claims_tenant
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON am_claims.form_availability FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON am_claims.form_availability TO am_claims_tenant;
GRANT SELECT ON am_claims.form_availability TO am_claims_platform_owner,am_claims_auditor;
COMMIT;
