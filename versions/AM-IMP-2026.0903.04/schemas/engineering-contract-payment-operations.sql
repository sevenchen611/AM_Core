-- AM-IMP-2026.0903.04
-- Engineering contract payment execution layer. PostgreSQL 14+.
--
-- This migration is additive and intentionally does not update schema_meta:
-- the runtime/store capability migration must be installed atomically by the
-- Engineering deployment owner. Do not run this file against a shared tenant
-- database and do not place live data or credentials in this package.

BEGIN;

CREATE SCHEMA IF NOT EXISTS engineering_contracts;

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_payment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES engineering_contracts.contracts(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES engineering_contracts.contract_versions(id) ON DELETE RESTRICT,
  source_milestone_id text NOT NULL CHECK (length(btrim(source_milestone_id)) BETWEEN 1 AND 160),
  source_version_sha256 text NOT NULL CHECK (source_version_sha256 ~ '^[0-9a-f]{64}$'),
  milestone_snapshot jsonb NOT NULL CHECK (jsonb_typeof(milestone_snapshot) = 'object'),
  status text NOT NULL DEFAULT 'not_due' CHECK (status IN (
    'not_due', 'eligible', 'claim_submitted', 'under_review', 'changes_requested',
    'approved', 'rejected', 'cancelled', 'paid_recorded', 'disputed'
  )),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  projected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (contract_id, version_id, source_milestone_id)
);

CREATE INDEX IF NOT EXISTS engineering_contract_payment_items_control_idx
  ON engineering_contracts.contract_payment_items (contract_id, status, projected_at DESC);

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_payment_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_item_id uuid NOT NULL REFERENCES engineering_contracts.contract_payment_items(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL REFERENCES engineering_contracts.contracts(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES engineering_contracts.contract_versions(id) ON DELETE RESTRICT,
  source_milestone_id text NOT NULL CHECK (length(btrim(source_milestone_id)) BETWEEN 1 AND 160),
  source_version_sha256 text NOT NULL CHECK (source_version_sha256 ~ '^[0-9a-f]{64}$'),
  amount numeric(16,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'TWD' CHECK (currency = 'TWD'),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'cancelled'
  )),
  submitted_by text NOT NULL CHECK (length(btrim(submitted_by)) BETWEEN 1 AND 240),
  submitted_at timestamptz NOT NULL,
  reviewed_by text,
  reviewed_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  source_summary text NOT NULL DEFAULT '' CHECK (length(source_summary) <= 300),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (status NOT IN ('under_review', 'changes_requested', 'rejected', 'approved') OR reviewed_at IS NOT NULL),
  CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  CHECK (approved_by IS NULL OR approved_by <> submitted_by),
  CHECK (approved_by IS NULL OR reviewed_by IS NULL OR approved_by <> reviewed_by)
);

CREATE INDEX IF NOT EXISTS engineering_contract_payment_claims_control_idx
  ON engineering_contracts.contract_payment_claims (contract_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS engineering_contract_payment_claims_item_idx
  ON engineering_contracts.contract_payment_claims (payment_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_payment_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES engineering_contracts.contract_payment_claims(id) ON DELETE RESTRICT,
  evidence_kind text NOT NULL CHECK (length(btrim(evidence_kind)) BETWEEN 1 AND 80),
  protected_reference text NOT NULL CHECK (length(btrim(protected_reference)) BETWEEN 1 AND 240),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (claim_id, protected_reference),
  UNIQUE (claim_id, sha256)
);

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES engineering_contracts.contract_payment_claims(id) ON DELETE RESTRICT,
  sequence_no bigint NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'claim_submitted', 'claim_review_started', 'claim_changes_requested',
    'claim_approved', 'claim_rejected', 'claim_cancelled', 'payment_recorded'
  )),
  event_version text NOT NULL CHECK (length(btrim(event_version)) BETWEEN 1 AND 160),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 16 AND 160),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_kind text NOT NULL CHECK (actor_kind IN ('internal_user', 'system', 'migration')),
  actor_ref text NOT NULL CHECK (length(btrim(actor_ref)) BETWEEN 1 AND 240),
  authority jsonb NOT NULL CHECK (jsonb_typeof(authority) = 'object'),
  evidence_fingerprint text NOT NULL CHECK (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(details) = 'object'
    AND NOT (details ?| ARRAY['bankAccount', 'accountNumber', 'transferInstruction', 'rawToken'])
  ),
  UNIQUE (claim_id, sequence_no),
  UNIQUE (claim_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS engineering_contract_payment_events_claim_idx
  ON engineering_contracts.contract_payment_events (claim_id, occurred_at, sequence_no);

CREATE OR REPLACE FUNCTION engineering_contracts.reject_contract_payment_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'engineering contract payment events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS engineering_contract_payment_events_no_update
  ON engineering_contracts.contract_payment_events;
CREATE TRIGGER engineering_contract_payment_events_no_update
BEFORE UPDATE OR DELETE ON engineering_contracts.contract_payment_events
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.reject_contract_payment_event_mutation();

COMMIT;
