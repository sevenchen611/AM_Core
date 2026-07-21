# AM-IMP-2026.0718.01 — Green Hotel operational memory

Status: Deployed — shared production PostgreSQL with strict tenant isolation

Green Hotel AM is deployed in `shadow` mode. Its operational memory now uses the AM Platform shared production PostgreSQL service through a Green-specific restricted runtime role and forced RLS.

## Migration result

1. Inspected the previous `green-hotel-am-memory-test` PostgreSQL resource before cutover.
2. Confirmed that every `am_memory` business table in the previous database contained zero rows; no LINE messages, events, tasks, decisions or knowledge records required copying.
3. Created the Green Hotel tenant row in the shared production database using tenant UUID `6c421e02-7ef7-4f98-8acb-758224689b58`.
4. Created a separate non-owner runtime role and applied the shared schema grants.
5. Verified PostgreSQL 18, fail-closed access without tenant context, allowed Green Hotel access and denied cross-tenant access.
6. Updated the AM Platform Render service to use the shared internal database connection for Green Hotel and retained `shadow` mode.

## Data boundary

- Green Hotel and Forest share one managed PostgreSQL resource, not one tenant identity.
- Each row carries `tenant_id`; the runtime role cannot own the schema or bypass RLS.
- Green Hotel Notion, LINE, Drive and source evidence remain Green-specific.

## Rollback

Set `GREEN_HOTEL_AM_MEMORY_MODE=off` and redeploy. Existing evidence and audit history are retained. The previous free test database is kept temporarily as a recovery reference and is not part of the active runtime.
