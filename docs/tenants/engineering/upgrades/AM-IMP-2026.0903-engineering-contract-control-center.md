# Engineering contract control center — 2026-09-03

Status: Deployed

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

## Database migration and access cleanup

On 2026-09-08, packages `.04` and `.05` were applied as additive PostgreSQL
migrations using a temporary owner-scoped connection. This created the payment
claim/event/evidence/item tables and the acceptance-event table with forced
tenant RLS, their policies, indexes, audit helpers, and runtime grants.

The restricted `engineering_contracts_runtime` role then completed read-only
production checks against both payment claims and acceptance events with the
Engineering tenant context. Both tables are accessible and contain zero rows.
No payment claim, payment action, acceptance event, contract transition, task,
Notion projection, or LINE message was created or changed by the migration.

After verification, the temporary database CONNECT and role-assumption grants
were revoked and the temporary Render environment secret was deleted. The
original owner and all pre-existing contracts, signing evidence, and functions
were left in place.

## Local verification

- All `dryrun-engineering-contract*.mjs` regression checks passed.
- Packages `.01` through `.05` passed `tools/check-upgrade-package.js`.
- No live data or credentials are included in the packages.
- Payment and acceptance schema migrations have been applied and verified with
  the restricted production runtime; both packages are `Deployed`.
