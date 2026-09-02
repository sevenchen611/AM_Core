# AM-IMP-2026.0902.15 - Party A profile constraint forward repair

Status: Ready

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

Production database installation and read-back remain pending.
