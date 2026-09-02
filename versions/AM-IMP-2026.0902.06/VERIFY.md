# Verify

- Run `node tools/dryrun-engineering-contract-store.mjs`.
- Run `node tools/dryrun-engineering-contract-workspace.mjs`.
- Run `node tools/dryrun-engineering-contract-management.mjs`.
- Run `node tools/dryrun-engineering-contract-workflow-api.mjs`.
- Confirm an otherwise complete personal Party A contract is not blocked by an
  empty company registration number.
- Confirm the workspace labels Party A's registration number as company-only.
- Confirm the production readiness banner no longer reports the evidence
  database as missing when schema v5 is installed.
- Confirm no LINE message is sent during verification.
