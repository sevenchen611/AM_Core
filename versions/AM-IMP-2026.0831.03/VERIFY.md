# Verify

1. Run `node tools/dryrun-engineering-contract-workspace.mjs`.
2. Run `node tools/dryrun-engineering-contract-draft-review.mjs`.
3. Run `node tools/dryrun-engineering-contract-workflow-api.mjs`.
4. Run `node tools/check-upgrade-package.js AM-IMP-2026.0831.03`.
5. Run `node tools/audit-alignment.js` and `node tools/compare-project-manifests.js`.
6. In production, open HZ-CT-001 V3 and confirm the internal-review panel offers a merged PDF and separate source attachments.
7. Verify only with GET requests; do not approve, return, issue, sign, or send LINE during deployment verification.
