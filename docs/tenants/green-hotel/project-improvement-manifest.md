# Green Hotel AM improvement manifest

| Version | Status | Scope | Verified | Notes |
| --- | --- | --- | --- | --- |
| AM-IMP-2026.0718.01 | Deployed | Shadow operational memory | Source database inventory, PostgreSQL migration, runtime-role separation, forced RLS isolation and Render deployment | Green Hotel uses the shared production PostgreSQL service with its own tenant UUID and restricted runtime role. The previous free test database contained no operational-memory rows, so no business records required copying. |
| AM-IMP-2026.0929.01 | Deployed | Scoped LINE input/output gateway | Render Live main commit, LINE webhook test, authenticated endpoints, unauthorized/group denial, accepted push and duplicate replay | Enabled in production for the configured transport group and fixed user; live user-message input canary remains pending. |
| AM-IMP-2026.0929.02 | Installed | Per-request LINE @recipient | Twelve API/provider behavior tests, bank webhook regression and delivery retry checks | Caller may override the configured default recipient; production verification pending. |

## Tenant boundary

- Tenant key: `green-hotel`
- Tenant UUID: `6c421e02-7ef7-4f98-8acb-758224689b58`
- PostgreSQL is shared at the service level only. Every Green Hotel row remains isolated by `tenant_id`, forced RLS and a tenant-specific runtime role.
- Shadow mode creates only candidate operational-memory records. Formal tasks, reminders and automatic external replies remain disabled.
