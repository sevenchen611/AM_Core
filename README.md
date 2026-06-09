# AM_Core

AM_Core is the shared planning and upgrade center for AM-style LINE/Notion assistant projects.

It is not a production LINE bot by itself. It stores shared architecture rules, upgrade package standards, reusable scripts, and version integration tools used by projects such as HOZO_AM and SevenAM.

## Current Decision

For now, do not immediately split all production code into a separate repo.

Use this order instead:

1. Standardize the upgrade package format.
2. Convert existing improvements into complete upgrade packages.
3. Install and verify the same packages in HOZO_AM and SevenAM separately.
4. After both projects reach version parity, extract the common AM core code into this project.
5. Leave each production project with only its private environment, deployment, and project adapter files.

## Important Separation Rule

AM_Core may contain shared logic, schemas, scripts, and documentation.

AM_Core must not contain:

- `.env` secret values
- LINE tokens or channel secrets
- Notion tokens
- Production Notion database IDs unless they are documented as project-local examples without secrets
- Render environment values
- Customer messages, reports, tasks, or automation logs from HOZO_AM or SevenAM

## Key Folders

| Folder | Purpose |
| --- | --- |
| `docs/` | Architecture, migration, versioning, and installation rules. |
| `versions/` | Future complete upgrade packages, one folder per AM-IMP version. |
| `templates/upgrade-package/` | Template for creating a complete upgrade package. |
| `tools/` | Local helper scripts for comparing version status and checking package completeness. |
| `config/` | Non-secret project registry and path settings. |
| `core/` | Future extracted shared AM core code. |
| `project-adapters/` | Future project-specific adapter templates. |

## Project Documents

AM_Core keeps a small project explanation document database at:

```text
D:\Codex_project\AM_Core\config\project-document-database.json
```

Human-readable index:

```text
D:\Codex_project\AM_Core\docs\PROJECT_DOCUMENT_DATABASE.md
```

## Current Core Storage

The current aligned runtime starting point is stored at:

```text
D:\Codex_project\AM_Core\core\runtime-template
```

The same folder can also be reached through:

```text
D:\Codex_project\AMCore
```

The source-preservation snapshot for both projects is stored at:

```text
D:\Codex_project\AM_Core\core\project-snapshots\2026-06-08-current-alignment
```

## Useful Commands

Compare installed version status:

```text
node D:\Codex_project\AM_Core\tools\compare-project-manifests.js
```

Check whether one upgrade package is complete:

```text
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-YYYY.MMDD.NN
```

Audit whether HOZO_AM and SevenAM are still aligned:

```text
node D:\Codex_project\AM_Core\tools\audit-alignment.js
```
