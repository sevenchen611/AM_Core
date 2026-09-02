BEGIN;

\if :{?runtime_role}
\else
  \echo 'runtime_role is required (use -v runtime_role=<restricted role>)'
  \quit 3
\endif

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'engineering_contracts.contract_line_conversation_archives'::regclass
       AND contype = 'c'
       AND (pg_get_constraintdef(oid) ILIKE '%stage%' OR pg_get_constraintdef(oid) ILIKE '%draft_review_id%')
  LOOP
    EXECUTE format('ALTER TABLE engineering_contracts.contract_line_conversation_archives DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;

ALTER TABLE engineering_contracts.contract_line_conversation_archives
  ADD CONSTRAINT engineering_contract_line_archives_stage_v5_check
    CHECK (stage IN ('draft_review','final_issue','historical_supplement')),
  ADD CONSTRAINT engineering_contract_line_archives_review_v5_check
    CHECK ((stage = 'draft_review' AND draft_review_id IS NOT NULL)
      OR (stage IN ('final_issue','historical_supplement') AND draft_review_id IS NULL));

GRANT USAGE ON SCHEMA engineering_contracts TO :"runtime_role";
GRANT SELECT, INSERT ON engineering_contracts.contract_line_conversation_archives TO :"runtime_role";

UPDATE engineering_contracts.schema_meta
   SET version = '2026-09-02.engineering-contract-evidence.v5', installed_at = clock_timestamp()
 WHERE singleton;

COMMIT;
