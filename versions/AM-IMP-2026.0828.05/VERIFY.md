# Verify — AM-IMP-2026.0828.05

Run:

```text
npm run check
npm run dryrun:contract-review
node tools/dryrun-engineering-contract-management.mjs
node tools/dryrun-engineering-contract-issuance.mjs
node tools/dryrun-engineering-contract-workflow-api.mjs
node tools/dryrun-engineering-contract-pdf-renderer.mjs
node D:\Codex_project\AMCore\tools\check-upgrade-package.js AM-IMP-2026.0828.05
node D:\Codex_project\AMCore\tools\audit-alignment.js
```

Database verification must prove schema version `2026-08-28.engineering-contract-evidence.v3`, forced RLS on both new tables, append-only review events, valid review-state transitions, and the restricted grants described in `INSTALL.md`.

Production verification must prove:

1. The internal contract workspace exposes the draft-send action only for a draft version with a contract body and an active project LINE group.
2. The generated PDF says `工程合約草約 - 僅供討論`, lists missing sections, and watermarks every page `DRAFT - NOT FOR SIGNATURE`.
3. The LINE message says the link is not a signing invitation.
4. The public page removes the raw token from the visible URL, is non-indexable/non-cacheable, and records first-open and response evidence.
5. A reviewer can choose no changes or request changes. A change request requires notes.
6. A completed response cannot be overwritten or deleted, and a later revision becomes V2/V3 rather than replacing V1.
7. Existing final-review, freeze, issue, and formal-signing gates still pass their regression tests.

The mock LINE dry run is sufficient for deployment verification. A real LINE message is an operator action and must not be sent merely for automated deployment testing.
