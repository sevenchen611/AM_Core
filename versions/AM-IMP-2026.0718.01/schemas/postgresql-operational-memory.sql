-- AM-IMP-2026.0718.01
-- PostgreSQL 15+ operational-memory foundation.
-- DDL only: no production records, connector identifiers, credentials, or secrets.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS am_memory;
REVOKE ALL ON SCHEMA am_memory FROM PUBLIC;

COMMENT ON SCHEMA am_memory IS
  'Tenant-isolated AM operational memory. Set app.tenant_id transaction-locally after authorization.';

CREATE OR REPLACE FUNCTION am_memory.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  value text;
BEGIN
  value := current_setting('app.tenant_id', true);
  IF value IS NULL OR btrim(value) = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN value::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION am_memory.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS am_memory.tenants (
  tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'migrating', 'disabled')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS am_memory.people (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  person_id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_system text NOT NULL,
  external_person_key text NOT NULL,
  display_name text NOT NULL,
  person_type text NOT NULL DEFAULT 'human'
    CHECK (person_type IN ('human', 'assistant', 'service', 'unknown')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'unknown')),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, person_id),
  UNIQUE (tenant_id, source_system, external_person_key)
);

CREATE TABLE IF NOT EXISTS am_memory.conversation_groups (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_system text NOT NULL,
  external_group_key text NOT NULL,
  group_name text NOT NULL,
  group_type text NOT NULL DEFAULT 'group'
    CHECK (group_type IN ('group', 'room', 'direct', 'meeting', 'other')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'unbound')),
  sensitivity text NOT NULL DEFAULT 'project'
    CHECK (sensitivity IN ('company', 'department', 'project', 'manager', 'executive', 'restricted')),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, group_id),
  UNIQUE (tenant_id, source_system, external_group_key)
);

CREATE TABLE IF NOT EXISTS am_memory.group_memberships (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  group_id uuid NOT NULL,
  person_id uuid NOT NULL,
  membership_role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, group_id, person_id),
  FOREIGN KEY (tenant_id, group_id)
    REFERENCES am_memory.conversation_groups(tenant_id, group_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, person_id)
    REFERENCES am_memory.people(tenant_id, person_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.entities (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  entity_id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_type text NOT NULL
    CHECK (entity_type IN ('organization', 'person', 'project', 'location', 'vendor',
      'product', 'document', 'topic', 'other')),
  canonical_name text NOT NULL,
  canonical_ref_type text,
  canonical_ref_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'merged')),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, entity_id)
);

CREATE TABLE IF NOT EXISTS am_memory.entity_aliases (
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'line', 'meeting', 'directory', 'learned')),
  confidence numeric(5,4) NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, entity_id, normalized_alias),
  UNIQUE (tenant_id, normalized_alias, entity_id),
  FOREIGN KEY (tenant_id, entity_id)
    REFERENCES am_memory.entities(tenant_id, entity_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS am_memory.source_records (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  source_id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_kind text NOT NULL
    CHECK (source_kind IN ('line_message', 'meeting', 'report', 'attachment', 'manual_correction',
      'system_suggestion', 'decision_action', 'external_document', 'other')),
  source_system text NOT NULL,
  external_source_key text NOT NULL,
  idempotency_key text NOT NULL,
  group_id uuid,
  author_person_id uuid,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source_locator jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_text text,
  content_sha256 text,
  immutable_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, source_id),
  UNIQUE (tenant_id, source_system, external_source_key),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, group_id)
    REFERENCES am_memory.conversation_groups(tenant_id, group_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, author_person_id)
    REFERENCES am_memory.people(tenant_id, person_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.raw_messages (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  raw_message_id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  source_system text NOT NULL,
  external_message_id text NOT NULL,
  group_id uuid,
  sender_person_id uuid,
  reply_to_external_message_id text,
  message_type text NOT NULL,
  original_content text,
  extracted_text text,
  occurred_at timestamptz NOT NULL,
  ingestion_status text NOT NULL DEFAULT 'received'
    CHECK (ingestion_status IN ('received', 'queued', 'processing', 'processed', 'failed', 'dead_letter')),
  raw_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, raw_message_id),
  UNIQUE (tenant_id, source_id),
  UNIQUE (tenant_id, source_system, external_message_id),
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, group_id)
    REFERENCES am_memory.conversation_groups(tenant_id, group_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, sender_person_id)
    REFERENCES am_memory.people(tenant_id, person_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.raw_attachments (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  attachment_id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  raw_message_id uuid,
  source_system text NOT NULL,
  external_attachment_id text NOT NULL,
  object_key text NOT NULL,
  media_type text,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  content_sha256 text,
  extracted_text text,
  extraction_status text NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'processing', 'complete', 'failed', 'approval_required', 'skipped')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, attachment_id),
  UNIQUE (tenant_id, source_id),
  UNIQUE (tenant_id, source_system, external_attachment_id),
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, raw_message_id)
    REFERENCES am_memory.raw_messages(tenant_id, raw_message_id) ON DELETE RESTRICT,
  CHECK (object_key !~* '^https?://')
);

CREATE TABLE IF NOT EXISTS am_memory.processing_jobs (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  job_id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_kind text NOT NULL,
  idempotency_key text NOT NULL,
  source_id uuid,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'leased', 'retry', 'succeeded', 'failed', 'dead_letter', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_payload jsonb,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, job_id),
  UNIQUE (tenant_id, job_kind, idempotency_key),
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.judgment_traces (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  judgment_trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_id uuid,
  job_id uuid,
  analyzer_name text NOT NULL,
  analyzer_version text NOT NULL,
  prompt_version text,
  rule_versions jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_name text,
  run_key text NOT NULL,
  input_sha256 text,
  output_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, judgment_trace_id),
  UNIQUE (tenant_id, analyzer_name, analyzer_version, run_key),
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, job_id)
    REFERENCES am_memory.processing_jobs(tenant_id, job_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.projects (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  project_id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_key text NOT NULL,
  project_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  description text,
  owner_person_id uuid,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'active', 'paused', 'completed', 'cancelled', 'archived')),
  confirmation_status text NOT NULL DEFAULT 'candidate'
    CHECK (confirmation_status IN ('candidate', 'confirmed', 'rejected')),
  phase text,
  priority text,
  start_date date,
  target_date date,
  latest_summary text,
  next_action text,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_source_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id),
  UNIQUE (tenant_id, project_key),
  FOREIGN KEY (tenant_id, owner_person_id)
    REFERENCES am_memory.people(tenant_id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, last_source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT,
  CHECK (status <> 'active' OR confirmation_status = 'confirmed')
);

CREATE TABLE IF NOT EXISTS am_memory.project_sources (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  source_id uuid NOT NULL,
  evidence_role text NOT NULL DEFAULT 'basis',
  evidence_excerpt text,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, source_id, evidence_role),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES am_memory.projects(tenant_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.project_members (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  person_id uuid NOT NULL,
  member_role text NOT NULL DEFAULT 'participant',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, person_id, member_role),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES am_memory.projects(tenant_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, person_id)
    REFERENCES am_memory.people(tenant_id, person_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.project_goals (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  goal_id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  goal_key text NOT NULL,
  title text NOT NULL,
  description text,
  success_criteria text NOT NULL,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'active', 'achieved', 'paused', 'cancelled')),
  confirmation_status text NOT NULL DEFAULT 'candidate'
    CHECK (confirmation_status IN ('candidate', 'confirmed', 'rejected')),
  owner_person_id uuid,
  target_date date,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no > 0),
  last_source_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, goal_id),
  UNIQUE (tenant_id, project_id, goal_key),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES am_memory.projects(tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, owner_person_id)
    REFERENCES am_memory.people(tenant_id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, last_source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT,
  CHECK (status <> 'active' OR confirmation_status = 'confirmed')
);

CREATE TABLE IF NOT EXISTS am_memory.project_goal_sources (
  tenant_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  source_id uuid NOT NULL,
  evidence_role text NOT NULL DEFAULT 'basis',
  evidence_excerpt text,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, goal_id, source_id, evidence_role),
  FOREIGN KEY (tenant_id, goal_id)
    REFERENCES am_memory.project_goals(tenant_id, goal_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.events (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('task_requested', 'decision_made', 'request_raised', 'issue_raised',
      'progress_reported', 'commitment_made', 'meeting_scheduled', 'risk_raised',
      'information_observed', 'question_raised', 'completion_reported',
      'cancellation_reported', 'change_reported', 'manual_correction', 'approval')),
  event_summary text NOT NULL,
  project_id uuid,
  topic_thread_key text,
  owner_person_id uuid,
  subject_status text,
  priority text,
  event_time timestamptz NOT NULL,
  due_at timestamptz,
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  confirmation_status text NOT NULL DEFAULT 'candidate'
    CHECK (confirmation_status IN ('candidate', 'confirmed', 'rejected')),
  supersedes_event_id uuid,
  judgment_trace_id uuid,
  rule_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES am_memory.projects(tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, owner_person_id)
    REFERENCES am_memory.people(tenant_id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supersedes_event_id)
    REFERENCES am_memory.events(tenant_id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, judgment_trace_id)
    REFERENCES am_memory.judgment_traces(tenant_id, judgment_trace_id) ON DELETE RESTRICT,
  CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> event_id),
  CHECK (confirmation_status <> 'confirmed' OR confirmed_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS am_memory.event_sources (
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  source_id uuid NOT NULL,
  evidence_role text NOT NULL DEFAULT 'basis',
  evidence_excerpt text,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, event_id, source_id, evidence_role),
  FOREIGN KEY (tenant_id, event_id)
    REFERENCES am_memory.events(tenant_id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.tasks (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  task_id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_key text NOT NULL,
  project_id uuid,
  goal_id uuid,
  parent_task_id uuid,
  title text NOT NULL,
  description text,
  assignee_person_id uuid,
  requester_person_id uuid,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'pending', 'in_progress', 'waiting',
      'pending_completion_confirmation', 'completed', 'cancelled', 'no_action')),
  confirmation_status text NOT NULL DEFAULT 'candidate'
    CHECK (confirmation_status IN ('candidate', 'confirmed', 'rejected')),
  formalization_status text NOT NULL DEFAULT 'candidate'
    CHECK (formalization_status IN ('candidate', 'formal', 'rejected')),
  priority text,
  due_at timestamptz,
  completed_at timestamptz,
  waiting_for text,
  blocker text,
  next_action text,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no > 0),
  last_source_id uuid,
  last_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, task_id),
  UNIQUE (tenant_id, task_key),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES am_memory.projects(tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, goal_id)
    REFERENCES am_memory.project_goals(tenant_id, goal_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, parent_task_id)
    REFERENCES am_memory.tasks(tenant_id, task_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, assignee_person_id)
    REFERENCES am_memory.people(tenant_id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, requester_person_id)
    REFERENCES am_memory.people(tenant_id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, last_source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, last_event_id)
    REFERENCES am_memory.events(tenant_id, event_id) ON DELETE RESTRICT,
  CHECK (parent_task_id IS NULL OR parent_task_id <> task_id),
  CHECK (status = 'candidate' OR formalization_status = 'formal'),
  CHECK (formalization_status <> 'formal' OR confirmation_status = 'confirmed'),
  CHECK (formalization_status <> 'formal' OR goal_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS am_memory.task_sources (
  tenant_id uuid NOT NULL,
  task_id uuid NOT NULL,
  source_id uuid NOT NULL,
  evidence_role text NOT NULL DEFAULT 'basis',
  evidence_excerpt text,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, task_id, source_id, evidence_role),
  FOREIGN KEY (tenant_id, task_id)
    REFERENCES am_memory.tasks(tenant_id, task_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.task_events (
  tenant_id uuid NOT NULL,
  task_id uuid NOT NULL,
  event_id uuid NOT NULL,
  relation_type text NOT NULL
    CHECK (relation_type IN ('created', 'updated', 'completed', 'reopened', 'blocked', 'reassigned', 'rescheduled', 'evidence')),
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, task_id, event_id, relation_type),
  FOREIGN KEY (tenant_id, task_id)
    REFERENCES am_memory.tasks(tenant_id, task_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, event_id)
    REFERENCES am_memory.events(tenant_id, event_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.task_history (
  tenant_id uuid NOT NULL,
  task_history_id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  change_type text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  source_id uuid,
  event_id uuid,
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, task_history_id),
  UNIQUE (tenant_id, task_id, version_no),
  FOREIGN KEY (tenant_id, task_id)
    REFERENCES am_memory.tasks(tenant_id, task_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, event_id)
    REFERENCES am_memory.events(tenant_id, event_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.decisions (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  decision_id uuid NOT NULL DEFAULT gen_random_uuid(),
  decision_series_id uuid NOT NULL DEFAULT gen_random_uuid(),
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no > 0),
  project_id uuid,
  title text NOT NULL,
  statement text NOT NULL,
  decision_maker text,
  background text,
  options_considered jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text,
  impact text,
  confirmation_status text NOT NULL DEFAULT 'candidate'
    CHECK (confirmation_status IN ('candidate', 'confirmed', 'rejected')),
  lifecycle_status text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_status IN ('draft', 'active', 'superseded', 'revoked')),
  supersedes_decision_id uuid,
  effective_from timestamptz,
  effective_to timestamptz,
  last_source_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, decision_id),
  UNIQUE (tenant_id, decision_series_id, version_no),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES am_memory.projects(tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supersedes_decision_id)
    REFERENCES am_memory.decisions(tenant_id, decision_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, last_source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT,
  CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> decision_id),
  CHECK (lifecycle_status <> 'active' OR confirmation_status = 'confirmed'),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS decisions_one_active_version
  ON am_memory.decisions (tenant_id, decision_series_id)
  WHERE lifecycle_status = 'active';

CREATE TABLE IF NOT EXISTS am_memory.decision_sources (
  tenant_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  source_id uuid NOT NULL,
  evidence_role text NOT NULL DEFAULT 'basis',
  evidence_excerpt text,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, decision_id, source_id, evidence_role),
  FOREIGN KEY (tenant_id, decision_id)
    REFERENCES am_memory.decisions(tenant_id, decision_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.decision_history (
  tenant_id uuid NOT NULL,
  decision_history_id uuid NOT NULL DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL,
  decision_series_id uuid NOT NULL,
  version_no integer NOT NULL,
  change_type text NOT NULL,
  from_lifecycle_status text,
  to_lifecycle_status text NOT NULL,
  supersedes_decision_id uuid,
  source_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, decision_history_id),
  FOREIGN KEY (tenant_id, decision_id)
    REFERENCES am_memory.decisions(tenant_id, decision_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.knowledge_items (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  knowledge_id uuid NOT NULL DEFAULT gen_random_uuid(),
  knowledge_key text NOT NULL,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no > 0),
  title text NOT NULL,
  category text NOT NULL,
  content text NOT NULL,
  applicable_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_person_id uuid,
  confirmation_status text NOT NULL DEFAULT 'candidate'
    CHECK (confirmation_status IN ('candidate', 'confirmed', 'rejected')),
  lifecycle_status text NOT NULL DEFAULT 'candidate'
    CHECK (lifecycle_status IN ('candidate', 'active', 'deprecated', 'expired', 'rejected')),
  effective_date date,
  expiry_date date,
  review_due_date date,
  supersedes_knowledge_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, knowledge_id),
  UNIQUE (tenant_id, knowledge_key, version_no),
  FOREIGN KEY (tenant_id, owner_person_id)
    REFERENCES am_memory.people(tenant_id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supersedes_knowledge_id)
    REFERENCES am_memory.knowledge_items(tenant_id, knowledge_id) ON DELETE RESTRICT,
  CHECK (lifecycle_status <> 'active' OR confirmation_status = 'confirmed'),
  CHECK (expiry_date IS NULL OR effective_date IS NULL OR expiry_date >= effective_date)
);

CREATE TABLE IF NOT EXISTS am_memory.knowledge_sources (
  tenant_id uuid NOT NULL,
  knowledge_id uuid NOT NULL,
  source_id uuid NOT NULL,
  evidence_role text NOT NULL DEFAULT 'basis',
  evidence_excerpt text,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, knowledge_id, source_id, evidence_role),
  FOREIGN KEY (tenant_id, knowledge_id)
    REFERENCES am_memory.knowledge_items(tenant_id, knowledge_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.project_snapshots (
  tenant_id uuid NOT NULL,
  project_snapshot_id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  as_of timestamptz NOT NULL,
  confirmation_status text NOT NULL DEFAULT 'candidate'
    CHECK (confirmation_status IN ('candidate', 'confirmed', 'rejected')),
  phase text,
  status text NOT NULL,
  summary text NOT NULL,
  next_action text,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_task_count integer NOT NULL DEFAULT 0 CHECK (open_task_count >= 0),
  generated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_snapshot_id),
  UNIQUE (tenant_id, project_id, as_of),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES am_memory.projects(tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.project_snapshot_sources (
  tenant_id uuid NOT NULL,
  project_snapshot_id uuid NOT NULL,
  source_id uuid NOT NULL,
  evidence_role text NOT NULL DEFAULT 'basis',
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_snapshot_id, source_id, evidence_role),
  FOREIGN KEY (tenant_id, project_snapshot_id)
    REFERENCES am_memory.project_snapshots(tenant_id, project_snapshot_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.daily_summaries (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  daily_summary_id uuid NOT NULL DEFAULT gen_random_uuid(),
  summary_date date NOT NULL,
  project_id uuid,
  summary_scope text NOT NULL DEFAULT 'tenant'
    CHECK (summary_scope IN ('tenant', 'project', 'group', 'department')),
  confirmation_status text NOT NULL DEFAULT 'candidate'
    CHECK (confirmation_status IN ('candidate', 'confirmed', 'rejected')),
  added_tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  progress_updates jsonb NOT NULL DEFAULT '[]'::jsonb,
  completions jsonb NOT NULL DEFAULT '[]'::jsonb,
  waiting_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  unanswered_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_by text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, daily_summary_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES am_memory.projects(tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.daily_summary_sources (
  tenant_id uuid NOT NULL,
  daily_summary_id uuid NOT NULL,
  source_id uuid NOT NULL,
  evidence_role text NOT NULL DEFAULT 'basis',
  evidence_excerpt text,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, daily_summary_id, source_id, evidence_role),
  FOREIGN KEY (tenant_id, daily_summary_id)
    REFERENCES am_memory.daily_summaries(tenant_id, daily_summary_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.access_principals (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  principal_id uuid NOT NULL DEFAULT gen_random_uuid(),
  identity_provider text NOT NULL,
  external_subject text NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('person', 'service', 'worker', 'scheduler')),
  person_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, principal_id),
  UNIQUE (tenant_id, identity_provider, external_subject),
  FOREIGN KEY (tenant_id, person_id)
    REFERENCES am_memory.people(tenant_id, person_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.access_grants (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  access_grant_id uuid NOT NULL DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('tenant', 'group', 'project', 'record')),
  scope_ref text NOT NULL,
  capability text NOT NULL,
  effect text NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow', 'deny')),
  sensitivity_ceiling text,
  valid_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  valid_until timestamptz,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, access_grant_id),
  UNIQUE (tenant_id, principal_id, scope_type, scope_ref, capability, effect),
  FOREIGN KEY (tenant_id, principal_id)
    REFERENCES am_memory.access_principals(tenant_id, principal_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE IF NOT EXISTS am_memory.answer_logs (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  answer_id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  principal_id uuid,
  question text NOT NULL,
  intent text,
  query_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  answer_text text,
  answer_status text NOT NULL DEFAULT 'draft'
    CHECK (answer_status IN ('draft', 'answered', 'insufficient_evidence', 'error')),
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  model_trace jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_feedback text CHECK (user_feedback IS NULL OR user_feedback IN ('correct', 'partly_correct', 'incorrect')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, answer_id),
  UNIQUE (tenant_id, request_id),
  FOREIGN KEY (tenant_id, principal_id)
    REFERENCES am_memory.access_principals(tenant_id, principal_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.answer_sources (
  tenant_id uuid NOT NULL,
  answer_id uuid NOT NULL,
  source_id uuid NOT NULL,
  rank_no integer NOT NULL CHECK (rank_no > 0),
  relevance numeric(5,4) CHECK (relevance IS NULL OR relevance BETWEEN 0 AND 1),
  usage_role text NOT NULL DEFAULT 'evidence',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, answer_id, source_id, usage_role),
  UNIQUE (tenant_id, answer_id, rank_no),
  FOREIGN KEY (tenant_id, answer_id)
    REFERENCES am_memory.answer_logs(tenant_id, answer_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES am_memory.source_records(tenant_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS am_memory.projection_outbox (
  tenant_id uuid NOT NULL REFERENCES am_memory.tenants(tenant_id) ON DELETE RESTRICT,
  outbox_id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  projection_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  source_event_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'retry', 'delivered', 'failed', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  PRIMARY KEY (tenant_id, outbox_id),
  UNIQUE (tenant_id, projection_type, idempotency_key),
  FOREIGN KEY (tenant_id, source_event_id)
    REFERENCES am_memory.events(tenant_id, event_id) ON DELETE RESTRICT
);

-- Candidate records may be confirmed only after direct source evidence is linked.
CREATE OR REPLACE FUNCTION am_memory.enforce_confirmation_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_status text;
  old_status text;
  target_status text;
  record_id uuid;
  has_evidence boolean;
BEGIN
  new_status := to_jsonb(NEW) ->> TG_ARGV[1];
  old_status := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> TG_ARGV[1] ELSE NULL END;
  target_status := COALESCE(NULLIF(TG_ARGV[4], ''), 'confirmed');
  IF new_status = target_status AND old_status IS DISTINCT FROM target_status THEN
    record_id := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM am_memory.%I WHERE tenant_id = $1 AND %I = $2)',
      TG_ARGV[2], TG_ARGV[3]
    ) INTO has_evidence USING NEW.tenant_id, record_id;
    IF NOT COALESCE(has_evidence, false) THEN
      RAISE EXCEPTION 'evidence gate rejected confirmation of %.%', TG_TABLE_NAME, record_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_confirmation_evidence
BEFORE INSERT OR UPDATE OF confirmation_status ON am_memory.projects
FOR EACH ROW EXECUTE FUNCTION am_memory.enforce_confirmation_evidence(
  'project_id', 'confirmation_status', 'project_sources', 'project_id');

CREATE TRIGGER project_goals_confirmation_evidence
BEFORE INSERT OR UPDATE OF confirmation_status ON am_memory.project_goals
FOR EACH ROW EXECUTE FUNCTION am_memory.enforce_confirmation_evidence(
  'goal_id', 'confirmation_status', 'project_goal_sources', 'goal_id');

CREATE TRIGGER events_confirmation_evidence
BEFORE INSERT OR UPDATE OF confirmation_status ON am_memory.events
FOR EACH ROW EXECUTE FUNCTION am_memory.enforce_confirmation_evidence(
  'event_id', 'confirmation_status', 'event_sources', 'event_id');

CREATE TRIGGER tasks_confirmation_evidence
BEFORE INSERT OR UPDATE OF confirmation_status ON am_memory.tasks
FOR EACH ROW EXECUTE FUNCTION am_memory.enforce_confirmation_evidence(
  'task_id', 'confirmation_status', 'task_sources', 'task_id');

CREATE TRIGGER tasks_formalization_evidence
BEFORE INSERT OR UPDATE OF formalization_status ON am_memory.tasks
FOR EACH ROW EXECUTE FUNCTION am_memory.enforce_confirmation_evidence(
  'task_id', 'formalization_status', 'task_sources', 'task_id', 'formal');

CREATE TRIGGER decisions_confirmation_evidence
BEFORE INSERT OR UPDATE OF confirmation_status ON am_memory.decisions
FOR EACH ROW EXECUTE FUNCTION am_memory.enforce_confirmation_evidence(
  'decision_id', 'confirmation_status', 'decision_sources', 'decision_id');

CREATE TRIGGER knowledge_confirmation_evidence
BEFORE INSERT OR UPDATE OF confirmation_status ON am_memory.knowledge_items
FOR EACH ROW EXECUTE FUNCTION am_memory.enforce_confirmation_evidence(
  'knowledge_id', 'confirmation_status', 'knowledge_sources', 'knowledge_id');

CREATE TRIGGER project_snapshots_confirmation_evidence
BEFORE INSERT OR UPDATE OF confirmation_status ON am_memory.project_snapshots
FOR EACH ROW EXECUTE FUNCTION am_memory.enforce_confirmation_evidence(
  'project_snapshot_id', 'confirmation_status', 'project_snapshot_sources', 'project_snapshot_id');

CREATE TRIGGER daily_summaries_confirmation_evidence
BEFORE INSERT OR UPDATE OF confirmation_status ON am_memory.daily_summaries
FOR EACH ROW EXECUTE FUNCTION am_memory.enforce_confirmation_evidence(
  'daily_summary_id', 'confirmation_status', 'daily_summary_sources', 'daily_summary_id');

-- Every meaningful task state change must advance the optimistic version and cite source evidence.
CREATE OR REPLACE FUNCTION am_memory.enforce_task_change_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed boolean;
BEGIN
  changed := ROW(OLD.status, OLD.assignee_person_id, OLD.due_at, OLD.blocker,
                 OLD.next_action, OLD.waiting_for, OLD.goal_id,
                 OLD.formalization_status, OLD.confirmation_status)
    IS DISTINCT FROM
             ROW(NEW.status, NEW.assignee_person_id, NEW.due_at, NEW.blocker,
                 NEW.next_action, NEW.waiting_for, NEW.goal_id,
                 NEW.formalization_status, NEW.confirmation_status);

  IF changed THEN
    IF NEW.version_no <> OLD.version_no + 1 THEN
      RAISE EXCEPTION 'task state changes must increment version_no by exactly one'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.last_source_id IS NULL OR NEW.last_event_id IS NULL THEN
      RAISE EXCEPTION 'task state changes require last_source_id and last_event_id evidence'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM am_memory.task_sources
       WHERE tenant_id = NEW.tenant_id
         AND task_id = NEW.task_id
         AND source_id = NEW.last_source_id
    ) THEN
      RAISE EXCEPTION 'task state-change source must be linked in task_sources'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM am_memory.task_events
       WHERE tenant_id = NEW.tenant_id
         AND task_id = NEW.task_id
         AND event_id = NEW.last_event_id
    ) THEN
      RAISE EXCEPTION 'task state-change event must be linked in task_events'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.version_no IS DISTINCT FROM OLD.version_no THEN
    RAISE EXCEPTION 'task version_no may change only with a state-bearing change'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_change_evidence
BEFORE UPDATE OF status, assignee_person_id, due_at, blocker, next_action, waiting_for,
  goal_id, formalization_status, confirmation_status, version_no
ON am_memory.tasks
FOR EACH ROW EXECUTE FUNCTION am_memory.enforce_task_change_evidence();

-- Activating a replacement decision closes the prior active version but never deletes it.
CREATE OR REPLACE FUNCTION am_memory.apply_decision_supersession()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_series_id uuid;
  prior_version integer;
  prior_status text;
BEGIN
  IF NEW.confirmation_status = 'confirmed'
     AND NEW.lifecycle_status = 'active'
     AND NEW.supersedes_decision_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR CASE WHEN TG_OP = 'UPDATE' THEN
         OLD.confirmation_status IS DISTINCT FROM NEW.confirmation_status
         OR OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status
         OR OLD.supersedes_decision_id IS DISTINCT FROM NEW.supersedes_decision_id
       ELSE false END
     ) THEN
    SELECT decision_series_id, version_no, lifecycle_status
      INTO prior_series_id, prior_version, prior_status
      FROM am_memory.decisions
     WHERE tenant_id = NEW.tenant_id
       AND decision_id = NEW.supersedes_decision_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'superseded decision does not exist in current tenant' USING ERRCODE = '23503';
    END IF;
    IF prior_series_id <> NEW.decision_series_id OR NEW.version_no <= prior_version THEN
      RAISE EXCEPTION 'decision replacement must stay in its series and increase version' USING ERRCODE = '23514';
    END IF;
    IF prior_status <> 'active' THEN
      RAISE EXCEPTION 'only the active decision version can be superseded' USING ERRCODE = '23514';
    END IF;

    UPDATE am_memory.decisions
       SET lifecycle_status = 'superseded',
           effective_to = COALESCE(NEW.effective_from, clock_timestamp()),
           updated_at = clock_timestamp()
     WHERE tenant_id = NEW.tenant_id
       AND decision_id = NEW.supersedes_decision_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER decisions_apply_supersession
BEFORE INSERT OR UPDATE OF confirmation_status, lifecycle_status, supersedes_decision_id
ON am_memory.decisions
FOR EACH ROW EXECUTE FUNCTION am_memory.apply_decision_supersession();

CREATE OR REPLACE FUNCTION am_memory.record_decision_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO am_memory.decision_history (
    tenant_id, decision_id, decision_series_id, version_no, change_type,
    from_lifecycle_status, to_lifecycle_status, supersedes_decision_id, source_id
  ) VALUES (
    NEW.tenant_id, NEW.decision_id, NEW.decision_series_id, NEW.version_no,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'state_changed' END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.lifecycle_status ELSE NULL END,
    NEW.lifecycle_status, NEW.supersedes_decision_id, NEW.last_source_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER decisions_record_history
AFTER INSERT OR UPDATE OF lifecycle_status, confirmation_status, supersedes_decision_id
ON am_memory.decisions
FOR EACH ROW EXECUTE FUNCTION am_memory.record_decision_history();

CREATE OR REPLACE FUNCTION am_memory.record_task_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO am_memory.task_history (
      tenant_id, task_id, version_no, change_type, from_status, to_status,
      source_id, event_id, changed_fields
    ) VALUES (
      NEW.tenant_id, NEW.task_id, NEW.version_no,
      'created', NULL,
      NEW.status, NEW.last_source_id, NEW.last_event_id,
      jsonb_build_object('assignee_person_id', NEW.assignee_person_id, 'due_at', NEW.due_at,
        'blocker', NEW.blocker, 'next_action', NEW.next_action,
        'waiting_for', NEW.waiting_for, 'goal_id', NEW.goal_id,
        'formalization_status', NEW.formalization_status,
        'confirmation_status', NEW.confirmation_status)
    );
  ELSIF ROW(OLD.status, OLD.assignee_person_id, OLD.due_at, OLD.blocker, OLD.next_action,
            OLD.waiting_for, OLD.goal_id, OLD.formalization_status, OLD.confirmation_status)
       IS DISTINCT FROM ROW(NEW.status, NEW.assignee_person_id, NEW.due_at, NEW.blocker,
            NEW.next_action, NEW.waiting_for, NEW.goal_id, NEW.formalization_status,
            NEW.confirmation_status) THEN
    INSERT INTO am_memory.task_history (
      tenant_id, task_id, version_no, change_type, from_status, to_status,
      source_id, event_id, changed_fields
    ) VALUES (
      NEW.tenant_id, NEW.task_id, NEW.version_no, 'state_changed', OLD.status,
      NEW.status, NEW.last_source_id, NEW.last_event_id,
      jsonb_build_object('assignee_person_id', NEW.assignee_person_id, 'due_at', NEW.due_at,
        'blocker', NEW.blocker, 'next_action', NEW.next_action,
        'waiting_for', NEW.waiting_for, 'goal_id', NEW.goal_id,
        'formalization_status', NEW.formalization_status,
        'confirmation_status', NEW.confirmation_status)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_record_history
AFTER INSERT OR UPDATE OF status, assignee_person_id, due_at, blocker, next_action,
  waiting_for, goal_id, formalization_status, confirmation_status
ON am_memory.tasks
FOR EACH ROW EXECUTE FUNCTION am_memory.record_task_history();

CREATE INDEX IF NOT EXISTS source_records_timeline_idx
  ON am_memory.source_records (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS raw_messages_group_timeline_idx
  ON am_memory.raw_messages (tenant_id, group_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS jobs_ready_idx
  ON am_memory.processing_jobs (tenant_id, status, available_at)
  WHERE status IN ('queued', 'retry');
CREATE INDEX IF NOT EXISTS events_project_timeline_idx
  ON am_memory.events (tenant_id, project_id, event_time DESC);
CREATE INDEX IF NOT EXISTS events_confirmed_type_idx
  ON am_memory.events (tenant_id, event_type, event_time DESC)
  WHERE confirmation_status = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS events_one_confirmed_successor_idx
  ON am_memory.events (tenant_id, supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL AND confirmation_status = 'confirmed';
CREATE INDEX IF NOT EXISTS tasks_active_due_idx
  ON am_memory.tasks (tenant_id, project_id, status, due_at)
  WHERE status IN ('pending', 'in_progress', 'waiting', 'pending_completion_confirmation');
CREATE INDEX IF NOT EXISTS knowledge_active_idx
  ON am_memory.knowledge_items (tenant_id, category, effective_date DESC)
  WHERE lifecycle_status = 'active';
CREATE INDEX IF NOT EXISTS answers_created_idx
  ON am_memory.answer_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projection_outbox_ready_idx
  ON am_memory.projection_outbox (tenant_id, status, available_at)
  WHERE status IN ('pending', 'retry');

-- Keep current-state timestamps consistent without relying on every caller.
CREATE TRIGGER tenants_touch_updated_at BEFORE UPDATE ON am_memory.tenants
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER people_touch_updated_at BEFORE UPDATE ON am_memory.people
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER groups_touch_updated_at BEFORE UPDATE ON am_memory.conversation_groups
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER entities_touch_updated_at BEFORE UPDATE ON am_memory.entities
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER project_members_touch_updated_at BEFORE UPDATE ON am_memory.project_members
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER raw_messages_touch_updated_at BEFORE UPDATE ON am_memory.raw_messages
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER raw_attachments_touch_updated_at BEFORE UPDATE ON am_memory.raw_attachments
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER jobs_touch_updated_at BEFORE UPDATE ON am_memory.processing_jobs
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER projects_touch_updated_at BEFORE UPDATE ON am_memory.projects
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER project_goals_touch_updated_at BEFORE UPDATE ON am_memory.project_goals
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER tasks_touch_updated_at BEFORE UPDATE ON am_memory.tasks
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER decisions_touch_updated_at BEFORE UPDATE ON am_memory.decisions
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER knowledge_touch_updated_at BEFORE UPDATE ON am_memory.knowledge_items
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER principals_touch_updated_at BEFORE UPDATE ON am_memory.access_principals
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();
CREATE TRIGGER projection_outbox_touch_updated_at BEFORE UPDATE ON am_memory.projection_outbox
FOR EACH ROW EXECUTE FUNCTION am_memory.touch_updated_at();

-- Fail closed: no tenant context means current_tenant_id() is NULL and every policy rejects.
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT tablename
      FROM pg_catalog.pg_tables
     WHERE schemaname = 'am_memory'
  LOOP
    EXECUTE format('ALTER TABLE am_memory.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE am_memory.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON am_memory.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON am_memory.%I FOR ALL USING (tenant_id = am_memory.current_tenant_id()) WITH CHECK (tenant_id = am_memory.current_tenant_id())',
      table_name
    );
  END LOOP;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA am_memory FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA am_memory REVOKE ALL ON TABLES FROM PUBLIC;

COMMIT;
