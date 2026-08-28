-- Additive production migration for the Engineering AM contract template library.
-- Run with the migration-owner role and ON_ERROR_STOP=1.
-- Existing project contracts, contract versions, and signing evidence are not changed.

BEGIN;

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'engineering' CHECK (tenant_key = 'engineering'),
  template_name text NOT NULL CHECK (length(btrim(template_name)) BETWEEN 1 AND 300),
  contract_type text NOT NULL CHECK (length(btrim(contract_type)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  current_version_id uuid,
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 240),
  updated_by text NOT NULL CHECK (length(btrim(updated_by)) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS engineering_contract_templates_name_uq
  ON engineering_contracts.contract_templates (tenant_key, lower(template_name))
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES engineering_contracts.contract_templates(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no >= 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  effective_date date,
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  drive_file_id text NOT NULL CHECK (length(btrim(drive_file_id)) > 0),
  file_name text NOT NULL CHECK (length(btrim(file_name)) > 0),
  mime_type text NOT NULL CHECK (length(btrim(mime_type)) > 0),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (template_id, version_no)
);

CREATE INDEX IF NOT EXISTS engineering_contract_template_versions_idx
  ON engineering_contracts.contract_template_versions (template_id, version_no DESC);

DO $am$
BEGIN
  ALTER TABLE engineering_contracts.contract_templates
    ADD CONSTRAINT engineering_contract_templates_current_version_fk
    FOREIGN KEY (current_version_id)
    REFERENCES engineering_contracts.contract_template_versions(id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$am$;

UPDATE engineering_contracts.schema_meta
SET version = '2026-08-28.engineering-contract-evidence.v2', installed_at = clock_timestamp()
WHERE singleton = true;

COMMIT;
