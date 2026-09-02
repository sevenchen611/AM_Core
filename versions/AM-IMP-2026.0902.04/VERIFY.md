# Verify

- `node tools/dryrun-engineering-contract-management.mjs`
- `node tools/dryrun-engineering-contract-workflow-api.mjs`
- `node tools/dryrun-engineering-contract-draft-review.mjs`
- `node tools/check-upgrade-package.js AM-IMP-2026.0902.04`
- `node tools/audit-alignment.js`

Required regression evidence:

- A store result containing `reviewed_at` as a JavaScript `Date` is normalized to the same ISO instant used by the transition request.
- The transition response passes the exact actor/time and immutable-content checks.
- A genuinely modified version package still fails with `CONTRACT_STORE_ADAPTER_VIOLATION`.
- Reloading HZ-CT-001 shows V12 in `internal_review`; deployment verification does not submit, approve, return, freeze, or issue any contract.
