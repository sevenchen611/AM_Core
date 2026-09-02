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
12. Backfill all historical sent versions, verify non-overlapping archive intervals, open at least one protected PDF, and confirm the current merged internal preview appends them.
13. Production verification must not approve, return, issue, sign, or send LINE.

Production result (2026-09-02): schema v4 is live; HZ-CT-001 V1 through V3
produced three tenant-scoped archives containing 17 messages in total. V1 was
opened through the protected archive endpoint, and no LINE message was resent.
