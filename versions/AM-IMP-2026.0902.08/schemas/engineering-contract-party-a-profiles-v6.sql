BEGIN;

\if :{?runtime_role}
\else
  \echo 'runtime_role is required (use -v runtime_role=<restricted role>)'
  \quit 3
\endif

CREATE TABLE IF NOT EXISTS engineering_contracts.party_a_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'engineering' CHECK (tenant_key = 'engineering'),
  profile_type text NOT NULL CHECK (profile_type IN ('company','individual')),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 240),
  legal_name text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 300),
  tax_id text CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{8}$'),
  responsible_person text CHECK (responsible_person IS NULL OR length(responsible_person) <= 240),
  representative text CHECK (representative IS NULL OR length(representative) <= 240),
  identity_number text CHECK (identity_number IS NULL OR length(identity_number) <= 30),
  address text NOT NULL CHECK (length(btrim(address)) BETWEEN 1 AND 500),
  assets jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(assets) = 'object'
    AND NOT (assets ?| ARRAY['base64','raw','bytes','dataUrl','publicUrl'])
  ),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 240),
  updated_by text NOT NULL CHECK (length(btrim(updated_by)) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  CHECK (
    (profile_type = 'company'
      AND tax_id ~ '^[0-9]{8}$'
      AND length(btrim(COALESCE(responsible_person,''))) > 0
      AND assets ? 'large_seal' AND assets ? 'small_seal')
    OR
    (profile_type = 'individual'
      AND tax_id IS NULL AND responsible_person IS NULL
      AND assets ? 'signature')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS engineering_contract_party_a_profiles_name_uq
  ON engineering_contracts.party_a_profiles (tenant_key, lower(display_name))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS engineering_contract_party_a_profiles_status_idx
  ON engineering_contracts.party_a_profiles (tenant_key, status, profile_type, display_name);

ALTER TABLE engineering_contracts.party_a_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_contracts.party_a_profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engineering_contract_party_a_profiles_tenant_policy
  ON engineering_contracts.party_a_profiles;
CREATE POLICY engineering_contract_party_a_profiles_tenant_policy
  ON engineering_contracts.party_a_profiles
  USING (tenant_key = current_setting('app.tenant_key', true))
  WITH CHECK (tenant_key = current_setting('app.tenant_key', true));

GRANT USAGE ON SCHEMA engineering_contracts TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON engineering_contracts.party_a_profiles TO :"runtime_role";

UPDATE engineering_contracts.schema_meta
   SET version = '2026-09-02.engineering-contract-evidence.v6', installed_at = clock_timestamp()
 WHERE singleton;

COMMIT;
