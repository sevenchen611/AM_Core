# Engineering contract control center — 2026-09-03

Status: Ready

## Delivered locally

- Capability-based v9 recovery check that fails closed when required authority
  tables are absent.
- Read-only control center that derives separate Party A, Party B, internal
  confirmation and archive state from PostgreSQL evidence.
- Evidence-gated action-task intent bridge; missing project goal or evidence
  becomes a candidate instead of a real task.
- Payment-claim and acceptance-control domain packages. Neither package can
  initiate a bank transfer, message, signature, or contract closure.

## Production gate

The local environment does not contain `ENG_CONTRACTS_DATABASE_URL`; therefore
no production contract records, signing sessions, Notion projections, LINE
messages, Drive files, payment claims, or acceptance records were queried or
changed. Before changing this record to Installed or Deployed, the Engineering
owner must apply the additive schemas with the restricted role, install the
project-local store adapters and role mapping, then run the read-only two-
contract evidence comparison described in package `.01`.

## Local verification

- All `dryrun-engineering-contract*.mjs` regression checks passed.
- Packages `.01` through `.05` passed `tools/check-upgrade-package.js`.
- No live data or credentials are included in the packages.
