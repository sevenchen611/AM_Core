# Verify

Verify separately in each project.

## Schema Checks

- `總控任務庫` has a relation field named `總控專案`.
- `總控專案庫` has the reciprocal relation field named `關聯任務`.
- Existing `專案` select remains available during migration.

## Record Checks

- Open a known project page.
- Confirm the page shows related tasks through `關聯任務`.
- Open a related task.
- Confirm the task points back to the project through `總控專案`.

## Dossier Checks

Open a meaningful project page and confirm the body includes:

- supporting tasks,
- success condition,
- conversation or meeting timeline,
- attachments and source pages,
- current judgment,
- next step,
- transfer, pause, or completion reason when applicable.

## Data Isolation Checks

- HOZO AM relation points only to HOZO AM project database.
- 7AM relation points only to 7AM project database.
- No project records, source conversations, or attachments are stored in AMCore.
