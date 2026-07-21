# AM-IMP-2026.0718.01 — Forest operational memory

Status: Blocked — PostgreSQL resource decision required

Forest AM is configured and deployed for the shared-platform tenant runtime in `shadow` mode. The runtime remains safely inactive until its PostgreSQL connection is provisioned.

## Installed code and policy

- Tenant UUID and `operationalMemory` policy are declared in `tenants/forest.json`.
- The tenant loads `collect`, `media`, `operational-memory`, `meetings`, `queue`, `tasks`, `reminders`, and `groups`.
- Formal task creation, reminders, automatic external replies, structured-first query answers, vector search, and knowledge promotion remain disabled.

## Required completion gates

1. Create Forest-only Notion projection databases under the Forest parent page. — Completed
2. Provision a dedicated PostgreSQL database and restricted runtime role. — Blocked pending database plan approval
3. Apply and verify the schema with `node --env-file=.env tools/install-tenant-operational-memory.mjs forest`.
4. Configure `FOREST_AM_MEMORY_DATABASE_URL` in the AM Platform Render service; `FOREST_AM_MEMORY_MODE=shadow` is already set.
5. Verify tenant RLS, a Forest group binding, raw ingestion, idempotency, candidate extraction, and `/health`.

## Rollback

Set `FOREST_AM_MEMORY_MODE=off`. Raw evidence and audit history are retained; no delete is part of rollback.
