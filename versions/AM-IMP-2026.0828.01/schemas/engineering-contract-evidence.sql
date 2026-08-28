-- AM-IMP-2026.0828.01
-- Engineering AM contract workflow and immutable electronic-signing evidence.
-- PostgreSQL 14+; run with a migration-owner role and ON_ERROR_STOP=1.
-- SECURITY GATE: this schema intentionally accepts only tenant_key=engineering
-- and has no cross-tenant RLS policy. Install it only in an Engineering-
-- dedicated database/credential boundary. A shared AM database is forbidden.
-- This schema contains structure only. Never place production values in this file.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS engineering_contracts;

COMMENT ON SCHEMA engineering_contracts IS
  'Engineering-only dedicated-database authority for contract workflow and electronic-signing evidence. Notion is projection only; this schema is not a shared-tenant RLS boundary.';

CREATE TABLE IF NOT EXISTS engineering_contracts.schema_meta (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO engineering_contracts.schema_meta (singleton, version)
VALUES (true, '2026-08-28.engineering-contract-evidence.v1')
ON CONFLICT (singleton) DO UPDATE
SET version = EXCLUDED.version,
    installed_at = clock_timestamp();

CREATE TABLE IF NOT EXISTS engineering_contracts.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'engineering' CHECK (tenant_key = 'engineering'),
  project_notion_page_id text NOT NULL CHECK (length(btrim(project_notion_page_id)) >= 16),
  project_code text NOT NULL DEFAULT '' CHECK (length(project_code) <= 80),
  notion_contract_page_id text NOT NULL CHECK (length(btrim(notion_contract_page_id)) >= 16),
  current_version_id uuid,
  contract_number text NOT NULL DEFAULT '' CHECK (length(contract_number) <= 120),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 500),
  trade text CHECK (trade IS NULL OR length(trade) <= 160),
  counterparty_name text CHECK (counterparty_name IS NULL OR length(counterparty_name) <= 240),
  counterparty_company text CHECK (counterparty_company IS NULL OR length(counterparty_company) <= 300),
  counterparty_title text CHECK (counterparty_title IS NULL OR length(counterparty_title) <= 160),
  amount numeric(16,2) CHECK (amount IS NULL OR amount >= 0),
  currency text NOT NULL DEFAULT 'TWD' CHECK (currency = 'TWD'),
  workflow_state text NOT NULL DEFAULT 'draft' CHECK (workflow_state IN (
    'draft', 'internal_review', 'ready_to_issue', 'issued', 'sent', 'opened',
    'signed', 'in_progress', 'completed', 'closed', 'declined', 'expired',
    'revoked', 'voided'
  )),
  execution_status text NOT NULL DEFAULT 'not_started' CHECK (execution_status IN (
    'not_started', 'in_progress', 'completed', 'closed', 'voided'
  )),
  budget_item_notion_page_id text,
  group_binding_notion_page_id text CHECK (
    group_binding_notion_page_id IS NULL OR length(btrim(group_binding_notion_page_id)) >= 16
  ),
  void_reason text,
  voided_at timestamptz,
  voided_by text,
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 240),
  updated_by text NOT NULL CHECK (length(btrim(updated_by)) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  CHECK (
    workflow_state <> 'voided'
    OR (length(btrim(COALESCE(void_reason, ''))) > 0 AND voided_at IS NOT NULL AND length(btrim(COALESCE(voided_by, ''))) > 0)
  )
);

CREATE INDEX IF NOT EXISTS engineering_contracts_contracts_project_idx
  ON engineering_contracts.contracts (tenant_key, project_notion_page_id, workflow_state);
CREATE UNIQUE INDEX IF NOT EXISTS engineering_contracts_contracts_number_uq
  ON engineering_contracts.contracts (tenant_key, contract_number)
  WHERE length(btrim(contract_number)) > 0;
CREATE UNIQUE INDEX IF NOT EXISTS engineering_contracts_contracts_notion_uq
  ON engineering_contracts.contracts (tenant_key, notion_contract_page_id);

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES engineering_contracts.contracts(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no >= 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'internal_review', 'approved', 'frozen', 'issued', 'superseded', 'voided'
  )),
  contract_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(contract_snapshot) = 'object'),
  bundle_manifest jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(bundle_manifest) = 'array'),
  bundle_sha256 text CHECK (bundle_sha256 IS NULL OR bundle_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_by text,
  reviewed_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  frozen_by text,
  frozen_at timestamptz,
  issued_pdf_drive_file_id text,
  issued_pdf_sha256 text CHECK (issued_pdf_sha256 IS NULL OR issued_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  issued_by text,
  issued_at timestamptz,
  superseded_by text,
  superseded_at timestamptz,
  voided_by text,
  voided_at timestamptz,
  void_reason text,
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (contract_id, version_no),
  CHECK (status NOT IN ('frozen', 'issued', 'superseded') OR (
    frozen_at IS NOT NULL
    AND length(btrim(COALESCE(frozen_by, ''))) > 0
    AND bundle_sha256 ~ '^[0-9a-f]{64}$'
    AND contract_snapshot <> '{}'::jsonb
    AND bundle_manifest <> '[]'::jsonb
  )),
  CHECK (status <> 'issued' OR (
    issued_at IS NOT NULL
    AND length(btrim(COALESCE(issued_by, ''))) > 0
    AND length(btrim(COALESCE(issued_pdf_drive_file_id, ''))) > 0
    AND issued_pdf_sha256 ~ '^[0-9a-f]{64}$'
  )),
  CHECK (status <> 'superseded' OR (
    superseded_at IS NOT NULL AND length(btrim(COALESCE(superseded_by, ''))) > 0
  )),
  CHECK (status <> 'voided' OR (
    voided_at IS NOT NULL
    AND length(btrim(COALESCE(voided_by, ''))) > 0
    AND length(btrim(COALESCE(void_reason, ''))) > 0
  ))
);

CREATE INDEX IF NOT EXISTS engineering_contract_versions_contract_idx
  ON engineering_contracts.contract_versions (contract_id, version_no DESC);

DO $am$
BEGIN
  ALTER TABLE engineering_contracts.contracts
    ADD CONSTRAINT engineering_contracts_current_version_fk
    FOREIGN KEY (current_version_id)
    REFERENCES engineering_contracts.contract_versions(id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$am$;

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES engineering_contracts.contract_versions(id) ON DELETE RESTRICT,
  document_kind text NOT NULL CHECK (document_kind IN (
    'contract_body', 'construction_drawing', 'quotation', 'acceptance_attachment', 'other'
  )),
  ordinal integer NOT NULL DEFAULT 1 CHECK (ordinal >= 1),
  drive_file_id text NOT NULL CHECK (length(btrim(drive_file_id)) >= 8),
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 500),
  mime_type text NOT NULL CHECK (length(btrim(mime_type)) BETWEEN 3 AND 160),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by text NOT NULL CHECK (length(btrim(uploaded_by)) BETWEEN 1 AND 240),
  uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (version_id, document_kind, ordinal),
  UNIQUE (version_id, drive_file_id)
);

CREATE INDEX IF NOT EXISTS engineering_contract_documents_version_idx
  ON engineering_contracts.contract_documents (version_id, document_kind, ordinal);

CREATE TABLE IF NOT EXISTS engineering_contracts.payment_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES engineering_contracts.contract_versions(id) ON DELETE RESTRICT,
  sequence_no integer NOT NULL CHECK (sequence_no >= 1),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 240),
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('fixed_datetime', 'milestone')),
  fixed_due_at timestamptz,
  due_date date,
  due_time time,
  time_zone text NOT NULL DEFAULT 'Asia/Taipei' CHECK (time_zone = 'Asia/Taipei'),
  trigger_text text,
  amount numeric(16,2) CHECK (amount IS NULL OR amount > 0),
  percentage numeric(7,4) CHECK (percentage IS NULL OR (percentage > 0 AND percentage <= 100)),
  evidence_required text NOT NULL DEFAULT '' CHECK (length(evidence_required) <= 2000),
  details text NOT NULL DEFAULT '' CHECK (length(details) <= 4000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (version_id, sequence_no),
  CHECK (amount IS NOT NULL OR percentage IS NOT NULL),
  CHECK (
    (trigger_kind = 'fixed_datetime' AND (fixed_due_at IS NOT NULL OR due_date IS NOT NULL))
    OR
    (trigger_kind = 'milestone' AND length(btrim(COALESCE(trigger_text, ''))) > 0)
  ),
  CHECK (due_time IS NULL OR due_date IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS engineering_contracts.acceptance_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES engineering_contracts.contract_versions(id) ON DELETE RESTRICT,
  sequence_no integer NOT NULL CHECK (sequence_no >= 1),
  criterion text NOT NULL CHECK (length(btrim(criterion)) BETWEEN 1 AND 4000),
  reference text NOT NULL DEFAULT '' CHECK (length(reference) <= 2000),
  verifier text NOT NULL DEFAULT '' CHECK (length(verifier) <= 500),
  verification_method text NOT NULL DEFAULT '' CHECK (length(verification_method) <= 2000),
  pass_condition text NOT NULL DEFAULT '' CHECK (length(pass_condition) <= 2000),
  evidence_required text NOT NULL DEFAULT '' CHECK (length(evidence_required) <= 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (version_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS engineering_contracts.signing_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_session_id text UNIQUE NOT NULL CHECK (external_session_id ~ '^cs_[A-Za-z0-9_-]{16,120}$'),
  version_id uuid NOT NULL REFERENCES engineering_contracts.contract_versions(id) ON DELETE RESTRICT,
  expected_signer_line_user_id text NOT NULL CHECK (expected_signer_line_user_id ~ '^U[A-Za-z0-9]{20,127}$'),
  expected_signer_name text NOT NULL CHECK (length(btrim(expected_signer_name)) BETWEEN 1 AND 240),
  expected_signer_company text CHECK (expected_signer_company IS NULL OR length(expected_signer_company) <= 300),
  expected_signer_title text CHECK (expected_signer_title IS NULL OR length(expected_signer_title) <= 160),
  group_binding_notion_page_id text NOT NULL CHECK (length(btrim(group_binding_notion_page_id)) >= 16),
  line_group_id text NOT NULL CHECK (length(btrim(line_group_id)) >= 8),
  token_digest text UNIQUE NOT NULL CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN (
    'issued', 'sent', 'opened', 'signed', 'confirmed', 'completed',
    'declined', 'expired', 'revoked'
  )),
  state_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(state_snapshot) = 'object'
    AND NOT (state_snapshot ?| ARRAY['rawToken', 'token', 'tokenPepper', 'liffAccessToken', 'databaseUrl'])
  ),
  issued_by text NOT NULL CHECK (length(btrim(issued_by)) BETWEEN 1 AND 240),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  received_at timestamptz,
  signed_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  declined_at timestamptz,
  expired_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  CHECK (expires_at = issued_at + interval '7 days'),
  CHECK (
    status <> 'revoked'
    OR (revoked_at IS NOT NULL AND length(btrim(COALESCE(revoked_by, ''))) > 0 AND length(btrim(COALESCE(revoke_reason, ''))) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS engineering_contract_signing_sessions_one_active_idx
  ON engineering_contracts.signing_sessions (version_id)
  WHERE status IN ('issued', 'sent', 'opened', 'signed', 'confirmed', 'completed');
CREATE INDEX IF NOT EXISTS engineering_contract_signing_sessions_token_idx
  ON engineering_contracts.signing_sessions (token_digest);
CREATE INDEX IF NOT EXISTS engineering_contract_signing_sessions_external_idx
  ON engineering_contracts.signing_sessions (external_session_id);

CREATE TABLE IF NOT EXISTS engineering_contracts.signing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES engineering_contracts.signing_sessions(id) ON DELETE RESTRICT,
  sequence_no bigint NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'issued', 'sent', 'delivery_ack', 'first_opened', 'signed',
    'submission_received', 'confirmed', 'completed', 'revoked', 'expired',
    'version_created', 'version_reviewed', 'version_issued',
    'line_send_requested', 'line_send_accepted', 'line_send_failed',
    'link_opened', 'liff_verified', 'group_membership_verified',
    'identity_verified', 'identity_rejected', 'signature_submitted',
    'signature_rejected', 'signed_pdf_stored', 'evidence_receipt_stored',
    'contract_signed', 'signer_declined', 'session_expired',
    'session_revoked', 'contract_voided', 'notion_projection_succeeded',
    'notion_projection_failed', 'administrative_correction'
  )),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 16 AND 160),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ip_address inet,
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 2000),
  actor_kind text NOT NULL CHECK (actor_kind IN ('admin', 'signer', 'system', 'provider')),
  actor_id text CHECK (actor_id IS NULL OR length(actor_id) <= 240),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(payload) = 'object'
    AND NOT (payload ?| ARRAY['rawToken', 'tokenPepper', 'liffAccessToken', 'databaseUrl'])
  ),
  previous_event_hash text CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^[0-9a-f]{64}$'),
  event_hash text UNIQUE NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (session_id, sequence_no),
  UNIQUE (session_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS engineering_contract_signing_events_session_idx
  ON engineering_contracts.signing_events (session_id, sequence_no);

CREATE TABLE IF NOT EXISTS engineering_contracts.signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signing_session_id uuid UNIQUE NOT NULL REFERENCES engineering_contracts.signing_sessions(id) ON DELETE RESTRICT,
  verified_signer_line_user_id text NOT NULL CHECK (verified_signer_line_user_id ~ '^U[A-Za-z0-9]{20,127}$'),
  verified_signer_name text NOT NULL CHECK (length(btrim(verified_signer_name)) BETWEEN 1 AND 240),
  signature_drive_file_id text NOT NULL CHECK (length(btrim(signature_drive_file_id)) >= 8),
  signature_sha256 text NOT NULL CHECK (signature_sha256 ~ '^[0-9a-f]{64}$'),
  ip_address inet NOT NULL,
  user_agent text NOT NULL CHECK (length(btrim(user_agent)) BETWEEN 1 AND 2000),
  consent_version text NOT NULL CHECK (length(btrim(consent_version)) BETWEEN 1 AND 120),
  liff_verified boolean NOT NULL CHECK (liff_verified),
  group_member_verified boolean NOT NULL CHECK (group_member_verified),
  specified_user_matched boolean NOT NULL CHECK (specified_user_matched),
  bundle_sha256 text NOT NULL CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(evidence_snapshot) = 'object'
    AND NOT (evidence_snapshot ?| ARRAY['rawToken', 'tokenPepper', 'liffAccessToken', 'databaseUrl'])
  ),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS engineering_contracts.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES engineering_contracts.contract_versions(id) ON DELETE RESTRICT,
  signing_session_id uuid REFERENCES engineering_contracts.signing_sessions(id) ON DELETE RESTRICT,
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('issued_pdf', 'signed_pdf', 'evidence_receipt')),
  drive_file_id text NOT NULL CHECK (length(btrim(drive_file_id)) >= 8),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object'
    AND NOT (metadata ?| ARRAY['rawToken', 'tokenPepper', 'liffAccessToken', 'databaseUrl'])
  ),
  CHECK (artifact_kind = 'issued_pdf' OR signing_session_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS engineering_contract_artifacts_unique_idx
  ON engineering_contracts.artifacts (
    version_id,
    artifact_kind,
    COALESCE(signing_session_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE TABLE IF NOT EXISTS engineering_contracts.integration_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid REFERENCES engineering_contracts.contracts(id) ON DELETE RESTRICT,
  signing_session_id uuid REFERENCES engineering_contracts.signing_sessions(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN (
    'line_signing_invitation', 'notion_contract_projection', 'drive_artifact_integrity_check'
  )),
  idempotency_key text UNIQUE NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 16 AND 160),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(payload) = 'object'
    AND NOT (payload ?| ARRAY['rawToken', 'tokenPepper', 'liffAccessToken', 'databaseUrl'])
  ),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (contract_id IS NOT NULL OR signing_session_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS engineering_contract_outbox_ready_idx
  ON engineering_contracts.integration_outbox (status, available_at)
  WHERE status IN ('pending', 'failed');

-- Mutable aggregate optimistic-concurrency metadata and signed-state gate.
CREATE OR REPLACE FUNCTION engineering_contracts.guard_contract_update()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_signature_count integer;
  v_signed_pdf_count integer;
  v_receipt_count integer;
  v_version_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    NEW.row_version := 1;
    RETURN NEW;
  END IF;

  IF NEW.row_version <> OLD.row_version + 1 THEN
    RAISE EXCEPTION 'contracts.row_version must increase by exactly one';
  END IF;

  IF NEW.tenant_key IS DISTINCT FROM OLD.tenant_key
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'immutable contract identity fields cannot change';
  END IF;

  IF NEW.workflow_state IN ('issued', 'sent', 'opened', 'signed', 'in_progress', 'completed', 'closed') THEN
    IF NEW.current_version_id IS NULL THEN
      RAISE EXCEPTION 'issued or later contract requires current_version_id';
    END IF;
    SELECT status INTO v_version_status
    FROM engineering_contracts.contract_versions
    WHERE id = NEW.current_version_id AND contract_id = NEW.id;
    IF v_version_status IS DISTINCT FROM 'issued' THEN
      RAISE EXCEPTION 'current version must be an issued version of this contract';
    END IF;
  END IF;

  -- Signing submission may precede PDF generation. Only execution completion or
  -- closure requires the normalized immutable signature and final artifacts.
  IF NEW.workflow_state IN ('completed', 'closed') THEN
    SELECT count(*) INTO v_signature_count
    FROM engineering_contracts.signatures sg
    JOIN engineering_contracts.signing_sessions ss ON ss.id = sg.signing_session_id
    WHERE ss.version_id = NEW.current_version_id;

    SELECT count(*) FILTER (WHERE artifact_kind = 'signed_pdf'),
           count(*) FILTER (WHERE artifact_kind = 'evidence_receipt')
      INTO v_signed_pdf_count, v_receipt_count
    FROM engineering_contracts.artifacts
    WHERE version_id = NEW.current_version_id;

    IF v_signature_count <> 1 OR v_signed_pdf_count < 1 OR v_receipt_count < 1 THEN
      RAISE EXCEPTION 'completed or closed contract requires one signature, signed PDF, and evidence receipt';
    END IF;
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS engineering_contracts_guard_contract_update ON engineering_contracts.contracts;
CREATE TRIGGER engineering_contracts_guard_contract_update
BEFORE INSERT OR UPDATE ON engineering_contracts.contracts
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.guard_contract_update();

-- Version lifecycle follows the management domain. Freeze is an atomic
-- approved -> frozen CAS; issue is a separate frozen -> issued transition.
CREATE OR REPLACE FUNCTION engineering_contracts.guard_contract_version()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft'
       OR NEW.frozen_at IS NOT NULL
       OR NEW.issued_at IS NOT NULL THEN
      RAISE EXCEPTION 'contract version must be inserted as draft';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'reviewed, frozen, issued, superseded, or voided contract version cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'contract version identity fields cannot change';
  END IF;

  IF NEW.status = OLD.status AND OLD.status IN ('draft', 'internal_review', 'approved') THEN
    v_allowed := true;
  ELSIF OLD.status = 'draft' AND NEW.status IN ('internal_review', 'voided') THEN
    v_allowed := true;
  ELSIF OLD.status = 'internal_review' AND NEW.status IN ('draft', 'approved', 'voided') THEN
    v_allowed := true;
  ELSIF OLD.status = 'approved' AND NEW.status IN ('draft', 'frozen', 'voided') THEN
    v_allowed := true;
  ELSIF OLD.status = 'frozen' AND NEW.status IN ('issued', 'superseded', 'voided') THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'illegal contract version transition: % -> %', OLD.status, NEW.status;
  END IF;

  IF OLD.status IN ('frozen', 'issued', 'superseded', 'voided')
     AND (
       NEW.contract_snapshot IS DISTINCT FROM OLD.contract_snapshot
       OR NEW.bundle_manifest IS DISTINCT FROM OLD.bundle_manifest
       OR NEW.bundle_sha256 IS DISTINCT FROM OLD.bundle_sha256
     ) THEN
    RAISE EXCEPTION 'frozen contract content, manifest, and bundle hash are immutable';
  END IF;

  IF OLD.status = 'approved' AND NEW.status = 'frozen' THEN
    IF NEW.contract_snapshot IS DISTINCT FROM OLD.contract_snapshot THEN
      RAISE EXCEPTION 'freeze cannot replace the authoritative stored snapshot';
    END IF;
    IF NEW.contract_snapshot = '{}'::jsonb
       OR NEW.bundle_manifest = '[]'::jsonb
       OR COALESCE(NEW.bundle_sha256, '') !~ '^[0-9a-f]{64}$'
       OR NEW.frozen_at IS NULL
       OR length(btrim(COALESCE(NEW.frozen_by, ''))) = 0 THEN
      RAISE EXCEPTION 'freeze gate requires validated snapshot, canonical manifest array, hash, time, and actor';
    END IF;
    IF NEW.issued_at IS NOT NULL OR NEW.issued_pdf_drive_file_id IS NOT NULL
       OR NEW.issued_pdf_sha256 IS NOT NULL OR NEW.issued_by IS NOT NULL THEN
      RAISE EXCEPTION 'freeze cannot also issue the contract version';
    END IF;
  END IF;

  IF NEW.status IN ('draft', 'internal_review', 'approved')
     AND (NEW.frozen_at IS NOT NULL OR NEW.frozen_by IS NOT NULL
          OR NEW.issued_at IS NOT NULL OR NEW.issued_by IS NOT NULL
          OR NEW.issued_pdf_drive_file_id IS NOT NULL OR NEW.issued_pdf_sha256 IS NOT NULL) THEN
    RAISE EXCEPTION 'pre-freeze version cannot contain freeze or issue evidence';
  END IF;

  IF OLD.status = 'frozen' AND NEW.status = 'issued' THEN
    IF NEW.contract_snapshot IS DISTINCT FROM OLD.contract_snapshot
       OR NEW.bundle_manifest IS DISTINCT FROM OLD.bundle_manifest
       OR NEW.bundle_sha256 IS DISTINCT FROM OLD.bundle_sha256
       OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at
       OR NEW.frozen_by IS DISTINCT FROM OLD.frozen_by THEN
      RAISE EXCEPTION 'issue may only add issued PDF/hash/actor/time to the frozen version';
    END IF;
    IF NEW.issued_at IS NULL
       OR length(btrim(COALESCE(NEW.issued_by, ''))) = 0
       OR length(btrim(COALESCE(NEW.issued_pdf_drive_file_id, ''))) = 0
       OR COALESCE(NEW.issued_pdf_sha256, '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'issue requires issued PDF, hash, actor, and time';
    END IF;
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS engineering_contracts_guard_contract_version ON engineering_contracts.contract_versions;
CREATE TRIGGER engineering_contracts_guard_contract_version
BEFORE INSERT OR UPDATE OR DELETE ON engineering_contracts.contract_versions
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.guard_contract_version();

-- Child bundle records are editable until the approved version is frozen.
CREATE OR REPLACE FUNCTION engineering_contracts.require_draft_version()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_version_id uuid;
  v_status text;
  v_issued_at timestamptz;
BEGIN
  v_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  SELECT status, issued_at INTO v_status, v_issued_at
  FROM engineering_contracts.contract_versions
  WHERE id = v_version_id
  FOR UPDATE;

  IF NOT FOUND OR v_status NOT IN ('draft', 'internal_review', 'approved')
     OR v_issued_at IS NOT NULL THEN
    RAISE EXCEPTION 'bundle child records can change only before version freeze';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.version_id IS DISTINCT FROM OLD.version_id THEN
    RAISE EXCEPTION 'bundle child cannot move to another version';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS engineering_contracts_documents_draft_only ON engineering_contracts.contract_documents;
CREATE TRIGGER engineering_contracts_documents_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON engineering_contracts.contract_documents
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.require_draft_version();

DROP TRIGGER IF EXISTS engineering_contracts_payments_draft_only ON engineering_contracts.payment_milestones;
CREATE TRIGGER engineering_contracts_payments_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON engineering_contracts.payment_milestones
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.require_draft_version();

DROP TRIGGER IF EXISTS engineering_contracts_acceptance_draft_only ON engineering_contracts.acceptance_criteria;
CREATE TRIGGER engineering_contracts_acceptance_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON engineering_contracts.acceptance_criteria
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.require_draft_version();

-- Session identity/token authority is immutable; state changes use optimistic CAS.
CREATE OR REPLACE FUNCTION engineering_contracts.guard_signing_session()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_version_status text;
  v_allowed boolean := false;
  v_signature_count integer;
  v_signed_pdf_count integer;
  v_receipt_count integer;
  v_signed_event_count integer;
  v_submission_event_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signing session cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_version_status
    FROM engineering_contracts.contract_versions
    WHERE id = NEW.version_id;
    IF v_version_status IS DISTINCT FROM 'issued' THEN
      RAISE EXCEPTION 'signing session requires an issued contract version';
    END IF;
    IF NEW.status <> 'issued' THEN
      RAISE EXCEPTION 'signing session must be inserted with issued status';
    END IF;
    NEW.issued_at := COALESCE(NEW.issued_at, clock_timestamp());
    NEW.expires_at := NEW.issued_at + interval '7 days';
    NEW.created_at := NEW.issued_at;
    NEW.updated_at := NEW.issued_at;
    NEW.row_version := 1;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.external_session_id IS DISTINCT FROM OLD.external_session_id
     OR NEW.version_id IS DISTINCT FROM OLD.version_id
     OR NEW.expected_signer_line_user_id IS DISTINCT FROM OLD.expected_signer_line_user_id
     OR NEW.expected_signer_name IS DISTINCT FROM OLD.expected_signer_name
     OR NEW.expected_signer_company IS DISTINCT FROM OLD.expected_signer_company
     OR NEW.expected_signer_title IS DISTINCT FROM OLD.expected_signer_title
     OR NEW.group_binding_notion_page_id IS DISTINCT FROM OLD.group_binding_notion_page_id
     OR NEW.line_group_id IS DISTINCT FROM OLD.line_group_id
     OR NEW.token_digest IS DISTINCT FROM OLD.token_digest
     OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'signing session authority fields are immutable';
  END IF;

  IF NEW.row_version <> OLD.row_version + 1 THEN
    RAISE EXCEPTION 'signing_sessions.row_version must increase by exactly one';
  END IF;

  IF NEW.status = OLD.status THEN
    v_allowed := true;
  ELSIF OLD.status = 'issued' AND NEW.status IN ('sent', 'declined', 'expired', 'revoked') THEN
    v_allowed := true;
  ELSIF OLD.status = 'sent' AND NEW.status IN ('opened', 'declined', 'expired', 'revoked') THEN
    v_allowed := true;
  ELSIF OLD.status = 'opened' AND NEW.status IN ('signed', 'declined', 'expired', 'revoked') THEN
    v_allowed := true;
  ELSIF OLD.status = 'signed' AND NEW.status = 'confirmed' THEN
    v_allowed := true;
  ELSIF OLD.status = 'confirmed' AND NEW.status = 'completed' THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'illegal signing session transition: % -> %', OLD.status, NEW.status;
  END IF;

  IF NEW.status = 'sent' AND OLD.status <> 'sent' AND NEW.sent_at IS NULL THEN
    NEW.sent_at := clock_timestamp();
  END IF;
  IF NEW.status = 'opened' AND OLD.status <> 'opened' AND NEW.received_at IS NULL THEN
    NEW.received_at := clock_timestamp();
  END IF;
  IF NEW.status = 'signed' AND OLD.status <> 'signed' AND NEW.signed_at IS NULL THEN
    NEW.signed_at := clock_timestamp();
  END IF;
  IF NEW.status = 'declined' AND OLD.status <> 'declined' AND NEW.declined_at IS NULL THEN
    NEW.declined_at := clock_timestamp();
  END IF;
  IF NEW.status = 'expired' AND OLD.status <> 'expired' AND NEW.expired_at IS NULL THEN
    NEW.expired_at := clock_timestamp();
  END IF;
  IF NEW.status = 'revoked' AND OLD.status <> 'revoked' THEN
    NEW.revoked_at := COALESCE(NEW.revoked_at, clock_timestamp());
    NEW.revoked_by := COALESCE(NULLIF(btrim(NEW.revoked_by), ''), NULLIF(NEW.state_snapshot #>> '{revocation,actorId}', ''), 'system');
    NEW.revoke_reason := COALESCE(NULLIF(btrim(NEW.revoke_reason), ''), NULLIF(NEW.state_snapshot #>> '{revocation,reason}', ''), 'manual_revoke');
  END IF;

  -- The signing service first commits signed + immutable events. A reviewer may
  -- confirm only after normalized signature evidence exists.
  IF NEW.status = 'confirmed' AND OLD.status <> 'confirmed' THEN
    SELECT count(*) INTO v_signature_count
    FROM engineering_contracts.signatures
    WHERE signing_session_id = NEW.id;

    SELECT count(*) FILTER (WHERE event_type = 'signed'),
           count(*) FILTER (WHERE event_type = 'submission_received')
      INTO v_signed_event_count, v_submission_event_count
    FROM engineering_contracts.signing_events
    WHERE session_id = NEW.id;

    IF v_signature_count <> 1 OR v_signed_event_count < 1 OR v_submission_event_count < 1 THEN
      RAISE EXCEPTION 'confirmed session requires one immutable signature plus signed and submission_received events';
    END IF;
    NEW.confirmed_at := COALESCE(
      NEW.confirmed_at,
      NULLIF(NEW.state_snapshot #>> '{confirmation,confirmedAt}', '')::timestamptz,
      clock_timestamp()
    );
  END IF;

  -- Final Drive products may be generated after submission. Completion is the
  -- fail-closed gate for both hashed artifacts.
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    SELECT count(*) FILTER (WHERE artifact_kind = 'signed_pdf'),
           count(*) FILTER (WHERE artifact_kind = 'evidence_receipt')
      INTO v_signed_pdf_count, v_receipt_count
    FROM engineering_contracts.artifacts
    WHERE signing_session_id = NEW.id;

    IF v_signed_pdf_count < 1 OR v_receipt_count < 1 THEN
      RAISE EXCEPTION 'completed session requires signed PDF and evidence receipt';
    END IF;
    NEW.completed_at := COALESCE(
      NEW.completed_at,
      NULLIF(NEW.state_snapshot #>> '{completion,completedAt}', '')::timestamptz,
      clock_timestamp()
    );
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS engineering_contracts_guard_signing_session ON engineering_contracts.signing_sessions;
CREATE TRIGGER engineering_contracts_guard_signing_session
BEFORE INSERT OR UPDATE OR DELETE ON engineering_contracts.signing_sessions
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.guard_signing_session();

-- Append a per-session hash chain. The session row lock serializes event sequence allocation.
CREATE OR REPLACE FUNCTION engineering_contracts.chain_signing_event()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_previous_hash text;
  v_previous_sequence bigint;
  v_material text;
BEGIN
  PERFORM 1
  FROM engineering_contracts.signing_sessions
  WHERE id = NEW.session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown signing session';
  END IF;

  SELECT event_hash, sequence_no
    INTO v_previous_hash, v_previous_sequence
  FROM engineering_contracts.signing_events
  WHERE session_id = NEW.session_id
  ORDER BY sequence_no DESC
  LIMIT 1;

  NEW.sequence_no := COALESCE(v_previous_sequence, 0) + 1;
  NEW.previous_event_hash := v_previous_hash;
  NEW.recorded_at := clock_timestamp();

  v_material := jsonb_build_object(
    'id', NEW.id::text,
    'sessionId', NEW.session_id::text,
    'sequence', NEW.sequence_no,
    'eventType', NEW.event_type,
    'idempotencyKey', NEW.idempotency_key,
    'occurredAt', NEW.occurred_at,
    'recordedAt', NEW.recorded_at,
    'ipAddress', COALESCE(host(NEW.ip_address), ''),
    'userAgent', NEW.user_agent,
    'actorKind', NEW.actor_kind,
    'actorId', NEW.actor_id,
    'payload', NEW.payload,
    'previousEventHash', NEW.previous_event_hash
  )::text;

  NEW.event_hash := encode(digest(convert_to(v_material, 'UTF8'), 'sha256'), 'hex');
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS engineering_contracts_chain_signing_event ON engineering_contracts.signing_events;
CREATE TRIGGER engineering_contracts_chain_signing_event
BEFORE INSERT ON engineering_contracts.signing_events
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.chain_signing_event();

CREATE OR REPLACE FUNCTION engineering_contracts.reject_immutable_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION '% is append-only; % is forbidden', TG_TABLE_NAME, TG_OP;
END
$fn$;

DROP TRIGGER IF EXISTS engineering_contracts_events_append_only ON engineering_contracts.signing_events;
CREATE TRIGGER engineering_contracts_events_append_only
BEFORE UPDATE OR DELETE ON engineering_contracts.signing_events
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.reject_immutable_evidence_mutation();

-- A signature is accepted only for the active, authenticated designated signer and exact bundle.
CREATE OR REPLACE FUNCTION engineering_contracts.guard_signature_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_expected_user_id text;
  v_session_status text;
  v_expires_at timestamptz;
  v_bundle_sha256 text;
  v_material text;
BEGIN
  SELECT ss.expected_signer_line_user_id, ss.status, ss.expires_at, cv.bundle_sha256
    INTO v_expected_user_id, v_session_status, v_expires_at, v_bundle_sha256
  FROM engineering_contracts.signing_sessions ss
  JOIN engineering_contracts.contract_versions cv ON cv.id = ss.version_id
  WHERE ss.id = NEW.signing_session_id
  FOR UPDATE OF ss;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown signing session';
  END IF;
  IF v_session_status NOT IN ('opened', 'signed') OR clock_timestamp() >= v_expires_at THEN
    RAISE EXCEPTION 'signing session is not opened/signed and unexpired';
  END IF;
  IF NEW.verified_signer_line_user_id <> v_expected_user_id THEN
    RAISE EXCEPTION 'verified signer does not match designated signer';
  END IF;
  IF NOT NEW.liff_verified OR NOT NEW.group_member_verified OR NOT NEW.specified_user_matched THEN
    RAISE EXCEPTION 'all signer identity checks are mandatory';
  END IF;
  IF NEW.bundle_sha256 IS DISTINCT FROM v_bundle_sha256 THEN
    RAISE EXCEPTION 'signature bundle hash does not match issued version';
  END IF;

  NEW.signed_at := clock_timestamp();
  v_material := jsonb_build_object(
    'sessionId', NEW.signing_session_id::text,
    'verifiedSignerLineUserId', NEW.verified_signer_line_user_id,
    'verifiedSignerName', NEW.verified_signer_name,
    'signatureDriveFileId', NEW.signature_drive_file_id,
    'signatureSha256', NEW.signature_sha256,
    'ipAddress', host(NEW.ip_address),
    'userAgent', NEW.user_agent,
    'consentVersion', NEW.consent_version,
    'liffVerified', NEW.liff_verified,
    'groupMemberVerified', NEW.group_member_verified,
    'specifiedUserMatched', NEW.specified_user_matched,
    'bundleSha256', NEW.bundle_sha256,
    'signedAt', NEW.signed_at,
    'evidence', NEW.evidence_snapshot
  )::text;
  NEW.evidence_sha256 := encode(digest(convert_to(v_material, 'UTF8'), 'sha256'), 'hex');
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS engineering_contracts_guard_signature_insert ON engineering_contracts.signatures;
CREATE TRIGGER engineering_contracts_guard_signature_insert
BEFORE INSERT ON engineering_contracts.signatures
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.guard_signature_insert();

DROP TRIGGER IF EXISTS engineering_contracts_signatures_append_only ON engineering_contracts.signatures;
CREATE TRIGGER engineering_contracts_signatures_append_only
BEFORE UPDATE OR DELETE ON engineering_contracts.signatures
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.reject_immutable_evidence_mutation();

-- Artifacts are immutable and signed artifacts must belong to the same session/version.
CREATE OR REPLACE FUNCTION engineering_contracts.guard_artifact_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_session_version_id uuid;
BEGIN
  IF NEW.signing_session_id IS NOT NULL THEN
    SELECT version_id INTO v_session_version_id
    FROM engineering_contracts.signing_sessions
    WHERE id = NEW.signing_session_id;
    IF v_session_version_id IS DISTINCT FROM NEW.version_id THEN
      RAISE EXCEPTION 'artifact session/version mismatch';
    END IF;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS engineering_contracts_guard_artifact_insert ON engineering_contracts.artifacts;
CREATE TRIGGER engineering_contracts_guard_artifact_insert
BEFORE INSERT ON engineering_contracts.artifacts
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.guard_artifact_insert();

DROP TRIGGER IF EXISTS engineering_contracts_artifacts_append_only ON engineering_contracts.artifacts;
CREATE TRIGGER engineering_contracts_artifacts_append_only
BEFORE UPDATE OR DELETE ON engineering_contracts.artifacts
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.reject_immutable_evidence_mutation();

COMMENT ON COLUMN engineering_contracts.signing_sessions.token_digest IS
  'Lowercase HMAC-SHA-256 of the opaque token using the tenant token pepper. Raw token is never stored.';
COMMENT ON COLUMN engineering_contracts.signing_sessions.state_snapshot IS
  'Signing-service state used by compare-and-swap. It must never contain raw tokens, LIFF tokens, or secrets.';
COMMENT ON COLUMN engineering_contracts.signing_sessions.row_version IS
  'Optimistic compare-and-swap version. Every UPDATE must set OLD.row_version + 1.';
COMMENT ON TABLE engineering_contracts.signing_events IS
  'Append-only, per-session SHA-256 hash chain. UPDATE and DELETE are rejected by trigger.';
COMMENT ON TABLE engineering_contracts.signatures IS
  'Append-only designated-signer evidence. UPDATE and DELETE are rejected by trigger.';
COMMENT ON TABLE engineering_contracts.artifacts IS
  'Append-only Drive artifact hashes for issued PDF, signed PDF, and evidence receipt.';
COMMENT ON TABLE engineering_contracts.integration_outbox IS
  'Retryable side effects. Notion projection and LINE delivery are not signing authority.';

REVOKE CREATE ON SCHEMA engineering_contracts FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA engineering_contracts FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA engineering_contracts FROM PUBLIC;

COMMIT;
