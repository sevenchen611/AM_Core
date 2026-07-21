# AM-IMP-2026.0718.01 — Forest operational memory

Status: Ready

Forest AM is configured for the shared-platform tenant runtime in `shadow` mode.

## Installed code and policy

- Tenant UUID and `operationalMemory` policy are declared in `tenants/forest.json`.
- The tenant loads `collect`, `media`, `operational-memory`, `meetings`, `queue`, `tasks`, `reminders`, and `groups`.
- Formal task creation, reminders, automatic external replies, structured-first query answers, vector search, and knowledge promotion remain disabled.

## Required completion gates

1. Create Forest-only Notion projection databases under the Forest parent page.
2. Provision a dedicated PostgreSQL database and restricted runtime role.
3. Apply and verify the schema with `node --env-file=.env tools/install-tenant-operational-memory.mjs forest`.
4. Configure `FOREST_AM_MEMORY_DATABASE_URL` and `FOREST_AM_MEMORY_MODE=shadow` in the AM Platform Render service.
5. Verify tenant RLS, a Forest group binding, raw ingestion, idempotency, candidate extraction, and `/health`.

## Rollback

Set `FOREST_AM_MEMORY_MODE=off`. Raw evidence and audit history are retained; no delete is part of rollback.
