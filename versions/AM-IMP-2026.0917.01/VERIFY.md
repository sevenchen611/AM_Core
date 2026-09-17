# Verify

Run:

```text
node tools/dryrun-engineering-contract-domain.mjs
node tools/dryrun-engineering-contract-management.mjs
node tools/dryrun-engineering-contract-workspace.mjs
node tools/dryrun-engineering-contract-workflow-api.mjs
node tools/dryrun-engineering-contract-payments.mjs
node tools/dryrun-engineering-contract-issuance.mjs
node tools/dryrun-engineering-contract-line-attachments.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0917.01
node tools/audit-alignment.js
node tools/compare-project-manifests.js
npm run check
```

Regressions must prove stale master totals do not block a valid saved version; changing a master after freeze cannot change version validation; actual mismatches and invalid explicit amounts still block storage; missing snapshot totals retain legacy fallback; version snapshots and master rows are not rewritten during freeze; percentage-only payment schedules use the issued version total; browser validation summaries compile, show exact totals and escape messages.

Production: verify actual Render main commit is Live, health passes, and the authenticated approved contract workspace shows the correct saved version/payment totals and passed validation. Keep the real contract approved: do not click freeze, issue, sign, or send LINE merely to test deployment.
