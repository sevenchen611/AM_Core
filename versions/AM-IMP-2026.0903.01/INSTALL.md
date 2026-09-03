# Install

1. Confirm the project already has the Engineering contract schema v9 migration.
2. Copy the shared `core/contract-store.js` runtime change into that project.
3. Run `node tools/dryrun-engineering-contract-control-recovery.mjs`.
4. In the project-local production environment, run the documented read-only
   schema/status check. Do not issue, confirm, archive, or rewrite contracts.
5. Record the project-local outcome in its improvement manifest.
