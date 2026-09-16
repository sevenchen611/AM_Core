# Verify

Run:

```text
node tools/dryrun-engineering-contract-line-attachments.mjs
node tools/dryrun-engineering-contract-workspace.mjs
node tools/dryrun-engineering-contract-workflow-api.mjs
node tools/dryrun-engineering-contract-signing-web.mjs
node tools/dryrun-engineering-contract-draft-review.mjs
node tools/dryrun-engineering-contract-management.mjs
node tools/dryrun-engineering-contract-scope.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0916.03
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

Tests cover tenant/project/group isolation, pagination, private Drive checks, unsupported or missing originals, deduplication, selected classifications, all-or-nothing version creation, preserved source evidence, stale-version denial and persistent exclusions.

Public reads must bind to the authorized session's issued version, never the latest internal draft. A modified attachment must fail SHA-256 verification. Viewing an attachment alone must not enable signing consent.

Production gate: verify the actual AM Platform service commit and live Engineering workspace, then test Android LINE PDF/image attachment viewing and external-browser Office/CAD download with an owner-approved sample. Do not claim mobile validation from desktop dry-runs.
