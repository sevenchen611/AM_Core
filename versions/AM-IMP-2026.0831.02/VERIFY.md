# Verify

1. Run `node tools/dryrun-engineering-contract-management.mjs`.
2. Run `node tools/dryrun-engineering-contract-workflow-api.mjs`.
3. Run `node tools/dryrun-engineering-contract-workspace.mjs`.
4. Run `node tools/dryrun-engineering-contract-draft-review.mjs`.
5. Run `node tools/dryrun-engineering-contract-store.mjs`.
6. Run `node tools/check-upgrade-package.js AM-IMP-2026.0831.02`.
7. Run `node tools/audit-alignment.js` and `node tools/compare-project-manifests.js`.
8. In production, confirm an internal-review version shows `退回草稿`, the overview shows the version workflow state, and no LINE message is sent during verification.
