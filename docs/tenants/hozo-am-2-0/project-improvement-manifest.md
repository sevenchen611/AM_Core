# HOZO AM 2.0 — Project Improvement Manifest

Tenant key: `hozo-am-2-0`  
Tenant UUID: `a72c78d7-5035-4e6e-8caf-9ec4d58c914f`  
Environment prefix: `HZ2`

| Version | Status | Capability | Scope | Notes |
| --- | --- | --- | --- | --- |
| AM-IMP-2026.0718.01 | Deployed | Operational memory | Raw evidence → events → project/task state → decisions/knowledge | Notion, Drive, 15 data sources and the shared PostgreSQL tenant row are live. PostgreSQL 18, separated runtime role, forced RLS and Render production health passed. |

## Tenant boundaries

- This is a new AM Platform tenant. It is not a migration or rename of `hozoam`.
- Existing `tenants/hozoam.json` and the standalone HOZO_AM project remain untouched.
- Notion parent is stored only in the platform `.env` under `HZ2_NOTION_PARENT_PAGE_ID`.
- Google Drive root is stored only in the platform `.env` under `HZ2_DRIVE_ROOT_FOLDER_ID`.
- Live messages, tasks, decisions, knowledge, attachments and logs must remain tenant-local.

## Activation gate

Keep `authorizationReady=false`, meeting formal task creation disabled and operational memory in shadow mode until all of these pass:

1. The Notion integration can access the declared parent page.
2. Tenant-local Notion data sources are provisioned and recorded under `HZ2_*`.
3. The Drive identity can access only the declared tenant root for this workflow.
4. The PostgreSQL tenant row and forced-RLS isolation checks pass.
5. At least one HOZO AM 2.0 LINE group is explicitly bound in shadow mode.
6. Raw evidence, idempotency, candidate extraction and cross-tenant denial are verified.

## Shared PostgreSQL connection

`operationalMemory.connectionEnvPrefix=FOREST` deliberately reuses the existing restricted shared-database runtime credential in Render without copying or exposing it. Isolation does not depend on the environment-variable name: every transaction sets HOZO AM 2.0's own tenant UUID, and forced PostgreSQL RLS must deny missing or different tenant contexts.
