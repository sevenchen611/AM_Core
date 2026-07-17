# AM-IMP-2026.0717.02 — Tenant group governance and admin entry

## Outcome

AM Platform adds one reusable tenant backend and one editable group-governance table. Every tenant keeps its own Notion group-binding rows; the code, UI and data-isolation guard are shared.

## Included

- `groups` module: `/admin?tenant=<key>` and `/groups?tenant=<key>`.
- Group-binding v2 fields: purpose, owner, capabilities, goal, status-update policy, reminder targets and audit fields.
- Core exposes v2 group metadata through `ctx.binding`.
- Existing-page Notion updates are tenant-checked before PATCH, closing the admin-page cross-tenant path.
- Router cache is invalidated immediately after a saved group change.
- Forest becomes the first validation tenant; no Forest-specific runtime is created.

## Data boundary

This package contains schema and code only. It never contains a tenant's Notion IDs, LINE group IDs, member maps, people, messages, tokens or PINs. Apply the schema separately to every tenant's own `*_GROUP_BINDINGS_DATA_SOURCE_ID`.
