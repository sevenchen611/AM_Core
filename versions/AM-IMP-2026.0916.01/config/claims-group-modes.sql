BEGIN;

ALTER TABLE am_claims.groups
  ADD COLUMN IF NOT EXISTS claim_mode TEXT NOT NULL DEFAULT 'internal_v3';

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claims_groups_claim_mode') THEN
    ALTER TABLE am_claims.groups
      ADD CONSTRAINT claims_groups_claim_mode
      CHECK (claim_mode IN ('external_claim_only','internal_v3'));
  END IF;
END
$constraints$;

-- Platform notification routing reads these tables outside a tenant transaction.
-- FORCE RLS therefore requires explicit read policies in addition to table grants.
DROP POLICY IF EXISTS claims_groups_platform_read ON am_claims.groups;
DROP POLICY IF EXISTS claims_members_platform_read ON am_claims.members;
CREATE POLICY claims_groups_platform_read ON am_claims.groups
  FOR SELECT TO am_claims_platform_owner USING (true);
CREATE POLICY claims_members_platform_read ON am_claims.members
  FOR SELECT TO am_claims_platform_owner USING (true);

COMMIT;
