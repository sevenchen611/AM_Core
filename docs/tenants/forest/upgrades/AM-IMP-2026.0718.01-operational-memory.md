# AM-IMP-2026.0718.01 — Forest operational memory

Status: Deployed — shared production PostgreSQL with strict tenant isolation

Forest AM is configured and deployed for the shared-platform tenant runtime in `shadow` mode. It uses the shared production PostgreSQL service through a dedicated restricted runtime role; tenant data is isolated with forced RLS.

## Installed code and policy

- Tenant UUID and `operationalMemory` policy are declared in `tenants/forest.json`.
- The tenant loads `collect`, `media`, `operational-memory`, `meetings`, `queue`, `tasks`, `reminders`, and `groups`.
- Formal task creation, reminders, automatic external replies, structured-first query answers, vector search, and knowledge promotion remain disabled.

## Required completion gates

1. Create Forest-only Notion projection databases under the Forest parent page. — Completed
2. Provision the shared production PostgreSQL service and Forest's restricted runtime role. — Completed
3. Apply and verify the schema with `node --env-file=.env tools/install-tenant-operational-memory.mjs forest`. — Completed; PostgreSQL 18 and runtime-role separation verified.
4. Configure the Forest runtime connection in the AM Platform Render service; `FOREST_AM_MEMORY_MODE=shadow` remains set. — Completed
5. Verify tenant RLS, a Forest group binding, raw ingestion, idempotency, candidate extraction, and `/health`. — RLS verified: no-context access fails closed, Forest access succeeds, and cross-tenant access is denied. Runtime health is available; live message ingestion begins only after Forest's LINE group binding receives a message.

## Rollback

Set `FOREST_AM_MEMORY_MODE=off`. Raw evidence and audit history are retained; no delete is part of rollback.
