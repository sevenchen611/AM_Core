# Engineering contract control center — 2026-09-03

Status: Blocked

## Deployed runtime and evidence check

- Capability-based v9 recovery check that fails closed when required authority
  tables are absent.
- Read-only control center that derives separate Party A, Party B, internal
  confirmation and archive state from PostgreSQL evidence.
- Evidence-gated action-task intent bridge; missing project goal or evidence
  becomes a candidate instead of a real task.
- Payment-claim and acceptance-control domain packages. Neither package can
  initiate a bank transfer, message, signature, or contract closure.

PR #119 is live on Render with the control-center/runtime recovery code. PR
#120 is live with the payment and acceptance adapters plus server-owned role
mapping. A read-only production query on 2026-09-07 confirmed two distinct
contracts: `HZ-CT-001` / 拆除合約 is at version 14 with both Party A and Party B
signing events, while its internal confirmation and completion timestamps are
empty; `HZ-CT-002` / 水電工程 is still draft and has no signing session. No
contract, task, Notion projection, LINE message, payment claim, or acceptance
event was changed.

## Blocked database migration gate

The Render service's restricted role (`engineering_contracts_runtime`) has the
intended least privilege and correctly rejects `CREATE TABLE`. The two additive
schema files were attempted with `ON_ERROR_STOP`; PostgreSQL stopped before any
object was created. The service environment contains no separate administrator
database connection. An Engineering database owner must provide a temporary
migration connection (or run packages `.04` and `.05` with a role that can
create tables, policies, functions, triggers, and grants), then revoke that
temporary access and rerun the read-only table/status verification.

## Local verification

- All `dryrun-engineering-contract*.mjs` regression checks passed.
- Packages `.01` through `.05` passed `tools/check-upgrade-package.js`.
- No live data or credentials are included in the packages.
- The payment and acceptance schema status remains `Blocked`; it must not be
  represented as `Deployed` until the additive database migrations verify.
