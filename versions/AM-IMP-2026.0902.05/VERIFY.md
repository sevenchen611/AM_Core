# Verify

- `node tools/dryrun-engineering-contract-store.mjs`
- `node tools/dryrun-engineering-contract-workspace.mjs`
- `node tools/dryrun-engineering-contract-management.mjs`
- `node tools/dryrun-engineering-contract-workflow-api.mjs`
- `node tools/check-upgrade-package.js AM-IMP-2026.0902.05`
- `node tools/audit-alignment.js`

Required evidence:

- Draft-to-review SQL replaces old `reviewed_at` and `reviewed_by` values on resubmission.
- The store source no longer applies `COALESCE` to review-submission evidence.
- The workspace reloads contract detail after an API error and recognizes an already-committed target state.
- HZ-CT-001 V12 remains in internal review and exposes `核准版本` after a read-only reload.
