# Verify

1. Run `node tools/dryrun-engineering-contract-line-archive-schema.mjs`.
2. Run `node tools/dryrun-engineering-contract-line-archive.mjs`.
3. Run `node tools/dryrun-engineering-contract-draft-review.mjs`.
4. Run `node tools/dryrun-engineering-contract-issuance.mjs`.
5. Run `node tools/dryrun-engineering-contract-completion.mjs`.
6. Run `node tools/dryrun-engineering-contract-workflow-api.mjs`.
7. Run `node tools/dryrun-engineering-contract-workspace.mjs`.
8. Run `node tools/dryrun-engineering-contract-store.mjs`.
9. Run `node tools/check-upgrade-package.js AM-IMP-2026.0831.04`.
10. Run `node tools/audit-alignment.js` and `node tools/compare-project-manifests.js`.
11. In production, verify schema version `2026-08-31.engineering-contract-evidence.v4`, forced RLS, immutable update/delete triggers, and restricted SELECT/INSERT grants.
12. Backfill HZ-CT-001 V1/V2, verify two non-overlapping archive intervals, open each PDF, and confirm the V3 merged internal preview appends them.
13. Production verification must not approve, return, issue, sign, or send LINE.
