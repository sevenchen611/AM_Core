# Forest AM improvement manifest

| Version | Status | Scope | Verified | Notes |
| --- | --- | --- | --- | --- |
| AM-IMP-2026.0718.01 | Ready | Shadow operational memory | Notion and Drive identity check | Tenant runtime and Notion foundation are being installed. PostgreSQL migration and Render runtime connection are still required before it becomes Installed. |

## Tenant boundary

- Tenant key: `forest`
- Tenant UUID: `aac8949f-0625-44d6-b655-57162f97143d`
- Data stays in Forest's own Notion parent, Drive root, PostgreSQL tenant row, and LINE group bindings.
- Shadow mode may create only candidate operational-memory records. It must not create formal tasks or send external replies.
