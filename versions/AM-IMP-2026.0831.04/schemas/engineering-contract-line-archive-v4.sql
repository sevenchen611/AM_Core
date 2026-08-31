BEGIN;

\if :{?runtime_role}
\else
  \echo 'runtime_role is required (use -v runtime_role=<restricted role>)'
  \quit 3
\endif

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_line_conversation_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_key text UNIQUE NOT NULL CHECK (length(btrim(archive_key)) BETWEEN 16 AND 220),
  version_id uuid NOT NULL REFERENCES engineering_contracts.contract_versions(id) ON DELETE RESTRICT,
  draft_review_id uuid REFERENCES engineering_contracts.contract_draft_reviews(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('draft_review','final_issue')),
  group_binding_notion_page_id text NOT NULL CHECK (length(btrim(group_binding_notion_page_id)) >= 16),
  line_group_id text NOT NULL CHECK (length(btrim(line_group_id)) >= 8),
  started_after timestamptz,
  ended_at timestamptz NOT NULL,
  first_message_id text,
  last_message_id text,
  message_count integer NOT NULL CHECK (message_count >= 0),
  source_manifest jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_manifest) = 'array'),
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_drive_file_id text NOT NULL CHECK (length(btrim(pdf_drive_file_id)) >= 8),
  pdf_sha256 text NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_byte_size bigint NOT NULL CHECK (pdf_byte_size > 0),
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ended_at > COALESCE(started_after, '-infinity'::timestamptz)),
  CHECK ((stage = 'draft_review' AND draft_review_id IS NOT NULL)
    OR (stage = 'final_issue' AND draft_review_id IS NULL))
);

CREATE INDEX IF NOT EXISTS engineering_contract_line_archives_version_idx
  ON engineering_contracts.contract_line_conversation_archives (version_id,ended_at,created_at);

CREATE OR REPLACE FUNCTION engineering_contracts.guard_contract_line_conversation_archive()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'LINE conversation archives are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engineering_contracts_line_archives_immutable
  ON engineering_contracts.contract_line_conversation_archives;
CREATE TRIGGER engineering_contracts_line_archives_immutable
BEFORE UPDATE OR DELETE ON engineering_contracts.contract_line_conversation_archives
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.guard_contract_line_conversation_archive();

ALTER TABLE engineering_contracts.contract_line_conversation_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_contracts.contract_line_conversation_archives FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engineering_contract_line_archives_tenant_policy
  ON engineering_contracts.contract_line_conversation_archives;
CREATE POLICY engineering_contract_line_archives_tenant_policy
  ON engineering_contracts.contract_line_conversation_archives
  USING (EXISTS (
    SELECT 1 FROM engineering_contracts.contract_versions v
    JOIN engineering_contracts.contracts c ON c.id = v.contract_id
    WHERE v.id = contract_line_conversation_archives.version_id
      AND c.tenant_key = current_setting('app.tenant_key', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM engineering_contracts.contract_versions v
    JOIN engineering_contracts.contracts c ON c.id = v.contract_id
    WHERE v.id = contract_line_conversation_archives.version_id
      AND c.tenant_key = current_setting('app.tenant_key', true)
  ));

GRANT USAGE ON SCHEMA engineering_contracts TO :"runtime_role";
GRANT SELECT, INSERT ON engineering_contracts.contract_line_conversation_archives TO :"runtime_role";

UPDATE engineering_contracts.schema_meta
   SET version = '2026-08-31.engineering-contract-evidence.v4', installed_at = clock_timestamp()
 WHERE singleton;

COMMIT;
