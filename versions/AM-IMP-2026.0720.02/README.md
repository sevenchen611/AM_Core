# AM-IMP-2026.0720.02 Green Hotel AM tenant bootstrap

This package registers **Green Hotel AM / 葉綠宿 AM** as an isolated AM Platform tenant.

It applies the current platform pattern: raw-source preservation, structured task and meeting handling, group-level routing, per-tenant Notion isolation, and a tenant-specific Drive root. It does not copy any customer conversation, Notion data, Drive file, credential, or LINE group binding into AMCore.

## Tenant state

`tenants/green-hotel.json` is intentionally fail-closed while setup is incomplete:

- `runtimeEnabled: false` keeps the tenant visible but prevents webhook, routes, and scheduled work.
- `authorizationReady: false` prevents Portal permission assignment.
- It may only be enabled after the Notion data sources, Drive root, shared OA routing, first group binding, tenant PostgreSQL operational memory, and tenant-neutral extraction modules have been verified.

All Notion actions use the platform-wide `BuildAM` connection and all Drive actions use the platform-wide `2014greenhotel@gmail.com` OAuth connection. Green Hotel AM has no tenant-specific integration identity.

The fixed Google account grants full Drive scope so AM Platform can use the existing Green Hotel folder. Runtime writes remain constrained to `GREEN_HOTEL_DRIVE_ROOT_FOLDER_ID`.

The AM-IMP-2026.0718.01 operational-memory adapter is wired into the platform and registered for Green Hotel, but remains explicitly `off` until a tenant-local PostgreSQL connection is supplied and its RLS migration is verified. The Notion projection foundation is already provisioned; it must not be represented as the PostgreSQL canonical memory core.

## Architecture mapping

| Required layer | Green Hotel AM implementation |
| --- | --- |
| Raw sources | Tenant-local Messages and Attachments data sources; source evidence remains linked to group bindings. |
| Events and task control | `collect`, `triage`, `queue`, and `tasks` process messages as evidence-backed control items rather than a message dump. |
| Project state and decisions | Tenant-local Projects, Tasks, Decisions, and project snapshots; live records never enter AMCore. |
| Knowledge and files | Tenant-local Knowledge data source plus a dedicated Green Hotel Drive root. Notion is the operating interface; PostgreSQL/event storage is a later production hardening step. |

The `meetings` module uses a separate meeting database per bound LINE group, protecting group and tenant boundaries.

## Required tenant-local data sources

Run the idempotent provisioner below. It is the authoritative schema implementation; do not create these sources manually from an older draft.

```text
node tools/provision-tenant-foundation.mjs green-hotel --parent-page=<Green-Hotel-parent-page-ID> --drive-root=<Green-Hotel-Drive-folder-ID>
```

It creates the following sources beneath the supplied Green Hotel parent page and writes only their IDs to the local `.env`.

1. Messages
2. Group Bindings
3. Attachments
4. Projects
5. Spaces
6. Work Items
7. Tasks
8. Meetings (optional shared legacy source; new meetings are per group)
9. Decisions
10. Knowledge Items
11. Events
12. Task History
13. Daily Summaries
14. Project Snapshots
15. Answer Logs

`schemas/notion-ddl.sql` is a readable schema contract; the provisioner remains the source of truth.
