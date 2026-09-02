# AM-IMP-2026.0902.15 - Party A profile constraint forward repair

Status: Deployed

## Engineering installation

- Remove the stale `party_a_profiles_check` that still requires an individual
  Party A master record to contain a reusable signature.
- Preserve the company profile requirement for a private large-seal asset.
- Restore the contract-specific Party A signature artifact value and the final
  confirmation gate in case production skipped those schema-v7 changes.
- Advance the Engineering contract database to schema v9 without changing the
  schema-v8 online signing event values.

## Verification boundary

The local regression test reproduces the production v6-to-v8 upgrade path,
confirms an empty-signature individual profile fails before the repair, applies
schema v9, and then verifies:

- the same individual profile succeeds with `assets = {}`;
- reusable individual signatures remain rejected;
- company profiles still require `large_seal`;
- `party_a_signature_image` remains accepted only as contract-bound evidence;
- individual contract confirmation still requires that immutable artifact.

## Production evidence

Production installation completed on 2026-09-02:

- PR #113 merged as `2a206bf9f18e92a20d6166f529ea4206255aa42a`.
- The Engineering contract database advanced transactionally from schema v8
  to `2026-09-02.engineering-contract-evidence.v9`.
- Before migration, `party_a_profiles_check` was present and no individual
  profile contained a legacy reusable signing asset.
- After migration, the stale check was absent; the canonical individual-empty-
  assets/company-large-seal check, contract-specific Party A artifact value,
  and confirmation trigger were all present.
- A production transaction inserted an identity-only individual profile with
  `assets = {}` successfully and then rolled back. No verification row remained.
- Temporary database-owner `CONNECT` and role-switch permissions were revoked
  and verified false after completion.
