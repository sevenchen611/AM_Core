BEGIN;

\if :{?runtime_role}
\else
  \echo 'runtime_role is required (use -v runtime_role=<restricted role>)'
  \quit 3
\endif

CREATE TABLE IF NOT EXISTS engineering_contracts.contract_acceptance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES engineering_contracts.contracts(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES engineering_contracts.contract_versions(id) ON DELETE RESTRICT,
  item_id text NOT NULL CHECK (length(btrim(item_id)) BETWEEN 1 AND 160),
  sequence_no bigint NOT NULL CHECK (sequence_no >= 1),
  event_type text NOT NULL CHECK (event_type IN (
    'acceptance_submitted', 'acceptance_reviewed', 'acceptance_reopened'
  )),
  previous_event_hash text NOT NULL DEFAULT '' CHECK (
    previous_event_hash = '' OR previous_event_hash ~ '^[0-9a-f]{64}$'
  ),
  event_hash text NOT NULL UNIQUE CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  actor text NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 240),
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (version_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS engineering_contract_acceptance_events_lookup_idx
  ON engineering_contracts.contract_acceptance_events (contract_id, version_id, sequence_no);

CREATE OR REPLACE FUNCTION engineering_contracts.guard_contract_acceptance_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_contract_id uuid;
  version_state text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'acceptance event records are append-only';
  END IF;

  SELECT contract_id, status INTO version_contract_id, version_state
    FROM engineering_contracts.contract_versions
   WHERE id = NEW.version_id;
  IF version_contract_id IS DISTINCT FROM NEW.contract_id THEN
    RAISE EXCEPTION 'acceptance event contract/version relation mismatch';
  END IF;
  IF version_state NOT IN ('frozen', 'issued', 'superseded') THEN
    RAISE EXCEPTION 'acceptance event requires a frozen contract version';
  END IF;

  IF NEW.sequence_no = 1 AND NEW.previous_event_hash <> '' THEN
    RAISE EXCEPTION 'first acceptance event cannot have a predecessor';
  END IF;
  IF NEW.sequence_no > 1 AND NOT EXISTS (
    SELECT 1 FROM engineering_contracts.contract_acceptance_events prior
     WHERE prior.version_id = NEW.version_id
       AND prior.sequence_no = NEW.sequence_no - 1
       AND prior.event_hash = NEW.previous_event_hash
  ) THEN
    RAISE EXCEPTION 'acceptance event predecessor does not match the immutable chain';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engineering_contract_acceptance_events_append_only
  ON engineering_contracts.contract_acceptance_events;
CREATE TRIGGER engineering_contract_acceptance_events_append_only
BEFORE INSERT OR UPDATE OR DELETE ON engineering_contracts.contract_acceptance_events
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.guard_contract_acceptance_event();

ALTER TABLE engineering_contracts.contract_acceptance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_contracts.contract_acceptance_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engineering_contract_acceptance_events_tenant_policy
  ON engineering_contracts.contract_acceptance_events;
CREATE POLICY engineering_contract_acceptance_events_tenant_policy
  ON engineering_contracts.contract_acceptance_events
  USING (EXISTS (
    SELECT 1
      FROM engineering_contracts.contracts c
     WHERE c.id = contract_acceptance_events.contract_id
       AND c.tenant_key = current_setting('app.tenant_key', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1
      FROM engineering_contracts.contracts c
     WHERE c.id = contract_acceptance_events.contract_id
       AND c.tenant_key = current_setting('app.tenant_key', true)
  ));

GRANT USAGE ON SCHEMA engineering_contracts TO :"runtime_role";
GRANT SELECT, INSERT ON engineering_contracts.contract_acceptance_events TO :"runtime_role";

COMMIT;
