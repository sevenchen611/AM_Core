BEGIN;

\if :{?runtime_role}
\else
  \echo 'runtime_role is required (use -v runtime_role=<restricted role>)'
  \quit 3
\endif

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_draft_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_review_id text UNIQUE NOT NULL CHECK (external_review_id ~ '^cr_[A-Za-z0-9_-]{16,120}$'),
  version_id uuid NOT NULL REFERENCES engineering_contracts.contract_versions(id) ON DELETE RESTRICT,
  group_binding_notion_page_id text NOT NULL CHECK (length(btrim(group_binding_notion_page_id)) >= 16),
  line_group_id text NOT NULL CHECK (length(btrim(line_group_id)) >= 8),
  token_digest text UNIQUE NOT NULL CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'created' CHECK (status IN (
    'created', 'sent', 'opened', 'no_changes', 'changes_requested', 'expired', 'revoked'
  )),
  draft_pdf_drive_file_id text NOT NULL CHECK (length(btrim(draft_pdf_drive_file_id)) >= 8),
  draft_pdf_sha256 text NOT NULL CHECK (draft_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  draft_pdf_byte_size bigint NOT NULL CHECK (draft_pdf_byte_size > 0),
  contract_body_drive_file_id text NOT NULL CHECK (length(btrim(contract_body_drive_file_id)) >= 8),
  contract_body_sha256 text NOT NULL CHECK (contract_body_sha256 ~ '^[0-9a-f]{64}$'),
  contract_body_file_name text NOT NULL CHECK (length(btrim(contract_body_file_name)) BETWEEN 1 AND 500),
  contract_body_mime_type text NOT NULL CHECK (length(btrim(contract_body_mime_type)) BETWEEN 3 AND 160),
  missing_sections jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(missing_sections) = 'array'),
  disclaimer_version text NOT NULL DEFAULT 'engineering-draft-review-v1',
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '14 days'),
  sent_at timestamptz,
  line_message_id text,
  opened_at timestamptz,
  responded_at timestamptz,
  reviewer_name text CHECK (reviewer_name IS NULL OR length(btrim(reviewer_name)) BETWEEN 1 AND 240),
  decision text CHECK (decision IS NULL OR decision IN ('no_changes', 'changes_requested')),
  response_notes text CHECK (response_notes IS NULL OR length(response_notes) <= 8000),
  response_ip inet,
  response_user_agent text CHECK (response_user_agent IS NULL OR length(response_user_agent) <= 2000),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  CHECK (status NOT IN ('no_changes', 'changes_requested') OR (
    responded_at IS NOT NULL AND reviewer_name IS NOT NULL AND decision = status
  )),
  CHECK (status <> 'changes_requested' OR length(btrim(COALESCE(response_notes, ''))) >= 2),
  CHECK (status <> 'revoked' OR (
    revoked_at IS NOT NULL AND length(btrim(COALESCE(revoked_by, ''))) > 0
    AND length(btrim(COALESCE(revoke_reason, ''))) > 0
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS engineering_contract_draft_reviews_one_active_idx
  ON engineering_contracts.contract_draft_reviews (version_id)
  WHERE status IN ('created', 'sent', 'opened');
CREATE INDEX IF NOT EXISTS engineering_contract_draft_reviews_version_idx
  ON engineering_contracts.contract_draft_reviews (version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS engineering_contract_draft_reviews_token_idx
  ON engineering_contracts.contract_draft_reviews (token_digest);

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_draft_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES engineering_contracts.contract_draft_reviews(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'created', 'line_send_accepted', 'first_opened', 'no_changes',
    'changes_requested', 'expired', 'revoked'
  )),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 12 AND 180),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_kind text NOT NULL CHECK (actor_kind IN ('admin', 'reviewer', 'system', 'provider')),
  actor_id text,
  ip_address inet,
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 2000),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  UNIQUE (review_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS engineering_contract_draft_review_events_idx
  ON engineering_contracts.contract_draft_review_events (review_id, occurred_at, id);

CREATE OR REPLACE FUNCTION engineering_contracts.guard_contract_draft_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'draft review records cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT status INTO version_state
      FROM engineering_contracts.contract_versions
     WHERE id = NEW.version_id;
    IF version_state IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'draft review requires a draft contract version';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('no_changes', 'changes_requested', 'expired', 'revoked') THEN
    RAISE EXCEPTION 'completed draft review records are immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.external_review_id IS DISTINCT FROM OLD.external_review_id
     OR NEW.version_id IS DISTINCT FROM OLD.version_id
     OR NEW.group_binding_notion_page_id IS DISTINCT FROM OLD.group_binding_notion_page_id
     OR NEW.line_group_id IS DISTINCT FROM OLD.line_group_id
     OR NEW.token_digest IS DISTINCT FROM OLD.token_digest
     OR NEW.draft_pdf_drive_file_id IS DISTINCT FROM OLD.draft_pdf_drive_file_id
     OR NEW.draft_pdf_sha256 IS DISTINCT FROM OLD.draft_pdf_sha256
     OR NEW.draft_pdf_byte_size IS DISTINCT FROM OLD.draft_pdf_byte_size
     OR NEW.contract_body_drive_file_id IS DISTINCT FROM OLD.contract_body_drive_file_id
     OR NEW.contract_body_sha256 IS DISTINCT FROM OLD.contract_body_sha256
     OR NEW.contract_body_file_name IS DISTINCT FROM OLD.contract_body_file_name
     OR NEW.contract_body_mime_type IS DISTINCT FROM OLD.contract_body_mime_type
     OR NEW.missing_sections IS DISTINCT FROM OLD.missing_sections
     OR NEW.disclaimer_version IS DISTINCT FROM OLD.disclaimer_version
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'draft review identity and source evidence are immutable';
  END IF;
  IF NOT (
    (OLD.status = 'created' AND NEW.status IN ('created', 'sent', 'revoked'))
    OR (OLD.status = 'sent' AND NEW.status IN ('sent', 'opened', 'no_changes', 'changes_requested', 'expired', 'revoked'))
    OR (OLD.status = 'opened' AND NEW.status IN ('opened', 'no_changes', 'changes_requested', 'expired', 'revoked'))
  ) THEN
    RAISE EXCEPTION 'invalid draft review status transition: % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.row_version <> OLD.row_version + 1 OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'draft review update requires monotonic row version and timestamp';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engineering_contracts_guard_draft_review
  ON engineering_contracts.contract_draft_reviews;
CREATE TRIGGER engineering_contracts_guard_draft_review
BEFORE INSERT OR UPDATE OR DELETE ON engineering_contracts.contract_draft_reviews
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.guard_contract_draft_review();

DROP TRIGGER IF EXISTS engineering_contracts_draft_review_events_append_only
  ON engineering_contracts.contract_draft_review_events;
CREATE TRIGGER engineering_contracts_draft_review_events_append_only
BEFORE UPDATE OR DELETE ON engineering_contracts.contract_draft_review_events
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.reject_immutable_evidence_mutation();

ALTER TABLE engineering_contracts.contract_draft_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_contracts.contract_draft_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE engineering_contracts.contract_draft_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_contracts.contract_draft_review_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engineering_contract_draft_reviews_tenant_policy
  ON engineering_contracts.contract_draft_reviews;
CREATE POLICY engineering_contract_draft_reviews_tenant_policy
  ON engineering_contracts.contract_draft_reviews
  USING (EXISTS (
    SELECT 1
      FROM engineering_contracts.contract_versions v
      JOIN engineering_contracts.contracts c ON c.id = v.contract_id
     WHERE v.id = contract_draft_reviews.version_id
       AND c.tenant_key = current_setting('app.tenant_key', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1
      FROM engineering_contracts.contract_versions v
      JOIN engineering_contracts.contracts c ON c.id = v.contract_id
     WHERE v.id = contract_draft_reviews.version_id
       AND c.tenant_key = current_setting('app.tenant_key', true)
  ));

DROP POLICY IF EXISTS engineering_contract_draft_review_events_tenant_policy
  ON engineering_contracts.contract_draft_review_events;
CREATE POLICY engineering_contract_draft_review_events_tenant_policy
  ON engineering_contracts.contract_draft_review_events
  USING (EXISTS (
    SELECT 1
      FROM engineering_contracts.contract_draft_reviews r
      JOIN engineering_contracts.contract_versions v ON v.id = r.version_id
      JOIN engineering_contracts.contracts c ON c.id = v.contract_id
     WHERE r.id = contract_draft_review_events.review_id
       AND c.tenant_key = current_setting('app.tenant_key', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1
      FROM engineering_contracts.contract_draft_reviews r
      JOIN engineering_contracts.contract_versions v ON v.id = r.version_id
      JOIN engineering_contracts.contracts c ON c.id = v.contract_id
     WHERE r.id = contract_draft_review_events.review_id
       AND c.tenant_key = current_setting('app.tenant_key', true)
  ));

GRANT USAGE ON SCHEMA engineering_contracts TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON engineering_contracts.contract_draft_reviews TO :"runtime_role";
GRANT SELECT, INSERT ON engineering_contracts.contract_draft_review_events TO :"runtime_role";

UPDATE engineering_contracts.schema_meta
   SET version = '2026-08-28.engineering-contract-evidence.v3', installed_at = clock_timestamp()
 WHERE singleton;

COMMIT;
