# Install

1. Share the Green Hotel Notion parent page with the existing **BuildAM** integration and the supplied Drive folder with **2014greenhotel@gmail.com**. Do not create or substitute tenant-specific connections.
2. Provision the tenant-local Notion data sources with the authoritative, idempotent tool:

```text
node tools/provision-tenant-foundation.mjs green-hotel --parent-page=<Green-Hotel-parent-page-ID> --drive-root=<Green-Hotel-Drive-folder-ID>
```

3. Confirm the generated IDs and Drive root exist only in the platform production `.env`, using `config/green-hotel-env.example` as the field list.
4. Apply the group-binding schema:

```text
node --env-file=.env tools/apply-group-binding-v2-schema.mjs green-hotel
```

5. Add the first LINE group in the Green Hotel Group Bindings source. Do not bind a group belonging to another tenant.
6. Keep `runtimeEnabled` and `authorizationReady` as `false` until the verification checklist passes, the tenant PostgreSQL operational-memory migration passes, and Green Hotel extraction modules have been verified in shadow mode.
7. Deploy the AM Platform service from its own project folder and verify production separately.

Do not place Notion IDs, Google Drive IDs, LINE IDs, OAuth values, or other credentials in this package or in tenant JSON.
