# Required databases and storage

## 1. Authoritative PostgreSQL schema

Apply `schemas/engineering-contract-evidence.sql` to a PostgreSQL database that
is dedicated to Engineering AM or isolated by credentials and schema ownership.
The schema name is fixed as `engineering_contracts`.

The migration role owns the schema. The runtime role should receive only:

- `USAGE` on schema `engineering_contracts`;
- `SELECT`, `INSERT`, and required workflow `UPDATE` on mutable aggregate,
  session, and outbox tables;
- `SELECT`, `INSERT` only on `signing_events`, `signatures`, and `artifacts`;
- sequence usage needed for inserts.

The runtime role must not have `CREATE`, `TRUNCATE`, `ALTER`, `DROP`, trigger
disablement, replication, or table-owner rights. The included triggers are an
application boundary, not a substitute for restricted database ownership and
backups.

## 2. Existing Notion data sources

No new authoritative Notion database is required. The target Engineering tenant
must already declare:

- `ENG_CONTRACTS_DATA_SOURCE_ID`
- `ENG_PROJECTS_DATA_SOURCE_ID`
- `ENG_GROUP_BINDINGS_DATA_SOURCE_ID`

Apply the additive property contract in
`notion-schemas/engineering-contract-projection.json` to the existing contracts
data source. Never copy rows or IDs from another project or tenant.

Notion is a projection. A Notion write failure creates or retains an
`integration_outbox` retry row and does not roll back a valid PostgreSQL signing
event. Conversely, a manual Notion edit never creates a PostgreSQL signature.

## 3. Google Drive

All files must remain below the target tenant's existing
`ENG_DRIVE_ROOT_FOLDER_ID`. Recommended layout:

```text
工程合約管理/
  <project stable id>/
    <contract uuid>/
      v<version>/
        source/
        issued/
        signed/
        evidence/
```

Folder names are for operators; PostgreSQL UUIDs and SHA-256 values are the
stable authority. Do not expose a permanently public Drive share. Downloads must
be authorized by the protected backend or the active designated-signer session.

## 4. Minimum backup policy

- PostgreSQL point-in-time recovery or equivalent managed backups must be on
  before signing is enabled.
- Drive deletion protection and organization retention policy must be reviewed.
- A restore drill must prove that an issued bundle, event chain, signed PDF, and
  receipt can be reconstructed without using Notion as authority.
- Rollback disables new signing but retains all evidence and files.
