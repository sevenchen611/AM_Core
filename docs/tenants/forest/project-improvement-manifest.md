# Forest AM improvement manifest

| Version | Status | Scope | Verified | Notes |
| --- | --- | --- | --- | --- |
| AM-IMP-2026.0718.01 | Blocked | Shadow operational memory | Notion/Drive identity, local checks, Render deploy and public health | Forest tenant runtime and Notion foundation are deployed. PostgreSQL migration and its dedicated restricted runtime connection still require a database-resource decision. |

## Tenant boundary

- Tenant key: `forest`
- Tenant UUID: `aac8949f-0625-44d6-b655-57162f97143d`
- Data stays in Forest's own Notion parent, Drive root, PostgreSQL tenant row, and LINE group bindings.
- Shadow mode may create only candidate operational-memory records. It must not create formal tasks or send external replies.
