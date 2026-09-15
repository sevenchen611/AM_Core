BEGIN;

ALTER TABLE am_claims.members ADD COLUMN IF NOT EXISTS tenant_key TEXT;
ALTER TABLE am_claims.members ADD COLUMN IF NOT EXISTS identity_reference TEXT;

CREATE INDEX IF NOT EXISTS claims_members_identity_reference_idx
  ON am_claims.members(tenant_key,identity_reference)
  WHERE identity_reference IS NOT NULL;

COMMIT;
