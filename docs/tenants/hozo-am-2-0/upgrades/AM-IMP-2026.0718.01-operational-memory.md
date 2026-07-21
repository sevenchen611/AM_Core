# AM-IMP-2026.0718.01 — HOZO AM 2.0 operational memory

Status: Installed — Render deployment verification pending

HOZO AM 2.0 uses the AM Platform shared production PostgreSQL service in `shadow` mode. It has its own tenant UUID and relies on transaction-local tenant context plus forced RLS for data isolation.

## Installation result

1. Created the tenant row using UUID `a72c78d7-5035-4e6e-8caf-9ec4d58c914f`.
2. Reused the existing restricted shared runtime connection through `operationalMemory.connectionEnvPrefix=FOREST`; no production database credential was copied or exposed.
3. Verified PostgreSQL 18 and confirmed that the runtime identity differs from the schema owner.
4. Verified fail-closed access without tenant context.
5. Verified HOZO AM 2.0 can read its own tenant row after setting its tenant context.
6. Verified a different tenant context cannot read the HOZO AM 2.0 tenant row.
7. Added `HZ2_AM_MEMORY_MODE=shadow` to the shared AM Platform Render service.

## Safety boundary

- Existing HOZO AM is unchanged.
- Formal task creation, reminders, automatic external replies, vector search and automatic knowledge promotion remain disabled.
- The shared runtime credential does not determine data ownership; every operation must set HOZO AM 2.0's tenant UUID inside the transaction.

## Rollback

Set `HZ2_AM_MEMORY_MODE=off` and redeploy. Retain the tenant row and audit history; no deletion is part of rollback.
