# Upgrade Package Standard

An improvement version must be stored as a complete upgrade package, not only as an MD note.

## Package Location

```text
D:\Codex_project\AM_Core\versions\AM-IMP-YYYY.MMDD.NN\
```

## Required Files

| File | Required | Purpose |
| --- | --- | --- |
| `README.md` | Yes | Human-readable summary and install intent. |
| `upgrade.json` | Yes | Machine-readable package metadata. |
| `INSTALL.md` | Yes | Exact install workflow. |
| `REQUIRED_DATABASES.md` | If needed | Notion database/schema requirements. |
| `ENVIRONMENT.md` | If needed | Required env vars and Render settings. |
| `VERIFY.md` | Yes | Local and production verification steps. |
| `ROLLBACK.md` | Yes | How to safely undo or disable the version. |
| `scripts/` | If needed | Install, sync, migration, and verification scripts. |
| `notion-schemas/` | If needed | JSON schemas for Notion database creation/checking. |
| `patches/` | If needed | Code patches or patch notes. |

## Required Metadata

Each `upgrade.json` must include:

```json
{
  "id": "AM-IMP-YYYY.MMDD.NN",
  "name": "Short improvement name",
  "type": "Reporting | LINE command | Safety | Governance | Core",
  "portable": true,
  "requiresDatabases": [],
  "requiresEnv": [],
  "requiresScripts": [],
  "installTargets": ["HOZO_AM", "SEVEN_AM"],
  "dataIsolation": {
    "canCopyCode": true,
    "canCopySchema": true,
    "canCopyData": false,
    "canCopySecrets": false
  },
  "definitionOfDone": [
    "Package files are complete",
    "Project manifest is updated",
    "Upgrade record is created",
    "Local verification passed"
  ]
}
```

## Completion Rule

A version is not considered installable until its package explains:

- What to build
- What files to install
- Which databases to create or check
- Which env vars are required
- How to verify success
- What status should be written to the project manifest

