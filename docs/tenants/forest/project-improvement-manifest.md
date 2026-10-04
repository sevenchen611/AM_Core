# Forest AM improvement manifest

| Version | Status | Scope | Verified | Notes |
| --- | --- | --- | --- | --- |
| AM-IMP-2026.1004.04 | Deployed | Durable attachment preservation | Group/room originals, retries, verified Drive storage and failure notices | Main commit b99dd8c, live ready health and independent 40,647,423-byte tenant storage canary verified; SHA256/MD5 match. Provider redelivery setting awaits login. |
| AM-IMP-2026.0718.01 | Deployed | Shadow operational memory | Notion/Drive identity, PostgreSQL migration, runtime-role separation, forced RLS isolation, Render deployment and public health | Forest uses the shared production PostgreSQL service with a dedicated restricted runtime role. Forest can access only its own tenant row; missing tenant context and a different tenant ID are denied. |

## Tenant boundary

- Tenant key: `forest`
- Tenant UUID: `aac8949f-0625-44d6-b655-57162f97143d`
- Data stays in Forest's own Notion parent, Drive root, PostgreSQL tenant row, and LINE group bindings.
- Shadow mode may create only candidate operational-memory records. It must not create formal tasks or send external replies.
