BEGIN;

\if :{?runtime_role}
\else
  \echo 'runtime_role is required (use -v runtime_role=<restricted role>)'
  \quit 3
\endif

-- Individual profiles retain identity data only. Remove any legacy reusable
-- signing asset references before tightening the profile invariant.
UPDATE engineering_contracts.party_a_profiles
   SET assets = '{}'::jsonb, updated_at = clock_timestamp(), row_version = row_version + 1
 WHERE profile_type = 'individual' AND assets <> '{}'::jsonb;

DO $do$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'engineering_contracts.party_a_profiles'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%assets ? %signature%'
  LOOP
    EXECUTE format('ALTER TABLE engineering_contracts.party_a_profiles DROP CONSTRAINT %I', item.conname);
  END LOOP;
END
$do$;

ALTER TABLE engineering_contracts.party_a_profiles
  DROP CONSTRAINT IF EXISTS engineering_contract_party_a_profile_requirements_check;
ALTER TABLE engineering_contracts.party_a_profiles
  ADD CONSTRAINT engineering_contract_party_a_profile_requirements_check CHECK (
    (profile_type = 'company'
      AND tax_id ~ '^[0-9]{8}$'
      AND length(btrim(COALESCE(responsible_person,''))) > 0
      AND assets ? 'large_seal')
    OR
    (profile_type = 'individual'
      AND tax_id IS NULL AND responsible_person IS NULL
      AND assets = '{}'::jsonb)
  ) NOT VALID;
ALTER TABLE engineering_contracts.party_a_profiles
  VALIDATE CONSTRAINT engineering_contract_party_a_profile_requirements_check;

-- A Party A signature is an immutable artifact of one signing session, never
-- a reusable profile asset.
DO $do$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'engineering_contracts.artifacts'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%artifact_kind%issued_pdf%signed_pdf%evidence_receipt%'
  LOOP
    EXECUTE format('ALTER TABLE engineering_contracts.artifacts DROP CONSTRAINT %I', item.conname);
  END LOOP;
END
$do$;

ALTER TABLE engineering_contracts.artifacts
  DROP CONSTRAINT IF EXISTS engineering_contract_artifact_kind_check;
ALTER TABLE engineering_contracts.artifacts
  ADD CONSTRAINT engineering_contract_artifact_kind_check CHECK (
    artifact_kind IN ('issued_pdf', 'party_a_signature_image', 'signed_pdf', 'evidence_receipt')
  ) NOT VALID;
ALTER TABLE engineering_contracts.artifacts
  VALIDATE CONSTRAINT engineering_contract_artifact_kind_check;

CREATE OR REPLACE FUNCTION engineering_contracts.require_individual_party_a_signature()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_profile_type text;
  v_signature_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'confirmed' AND OLD.status <> 'confirmed' THEN
    SELECT COALESCE(
             v.contract_snapshot #>> '{documentPackage,contractFields,partyAProfileType}',
             v.contract_snapshot #>> '{documentPackage,partyAProfileSnapshot,profileType}',
             v.contract_snapshot #>> '{snapshot,documentPackage,contractFields,partyAProfileType}'
           )
      INTO v_profile_type
      FROM engineering_contracts.contract_versions v
     WHERE v.id = NEW.version_id;

    IF v_profile_type = 'individual' THEN
      SELECT count(*) INTO v_signature_count
        FROM engineering_contracts.artifacts
       WHERE signing_session_id = NEW.id
         AND version_id = NEW.version_id
         AND artifact_kind = 'party_a_signature_image';
      IF v_signature_count <> 1 THEN
        RAISE EXCEPTION 'individual Party A confirmation requires one immutable contract-specific signature artifact';
      END IF;
    ELSIF v_profile_type IS DISTINCT FROM 'company' THEN
      RAISE EXCEPTION 'Party A profile type is required before confirmation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS engineering_contracts_require_party_a_signature
  ON engineering_contracts.signing_sessions;
CREATE TRIGGER engineering_contracts_require_party_a_signature
BEFORE UPDATE ON engineering_contracts.signing_sessions
FOR EACH ROW EXECUTE FUNCTION engineering_contracts.require_individual_party_a_signature();

UPDATE engineering_contracts.schema_meta
   SET version = '2026-09-02.engineering-contract-evidence.v7', installed_at = clock_timestamp()
 WHERE singleton;

COMMIT;
