# AM_Core

AM_Core is the **version master and core-code holder** for AM-style LINE/Notion assistant projects.

It is not a production LINE bot by itself. It stores shared architecture rules, upgrade package standards, reusable scripts, and version integration tools used by projects such as HOZO_AM and SevenAM, and it holds one upgrade package for every `AM-IMP` version in the family.

## Version State

AM_Core's own version and the current ecosystem version are tracked in:

- [VERSION.md](VERSION.md) — human-readable dashboard (generated)
- [config/amcore-version.json](config/amcore-version.json) — machine-readable state (generated)
- [docs/CURRENT_VERSION_MATRIX.md](docs/CURRENT_VERSION_MATRIX.md) — per-project status (generated)

Refresh all three after any version change:

```text
node tools/build-amcore-version.js
```

- **AM_Core version** = the highest `AM-IMP` version packaged in `versions/` ("what version AM_Core itself is").
- **Latest tracked improvement** = the highest `AM-IMP` version known to any project manifest or the shared registry ("the current version of the family").
- AM_Core is **current** when it packages every tracked version. Backfill any gaps with `node tools/backfill-version-packages.js`.

Deploying a new (third or later) AM project from AM_Core: see [docs/NEW_PROJECT_DEPLOYMENT.md](docs/NEW_PROJECT_DEPLOYMENT.md).

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

Refresh AM_Core's version state (VERSION.md, amcore-version.json, version matrix):

```text
node D:\Codex_project\AM_Core\tools\build-amcore-version.js
```

Backfill packages for any tracked version not yet held in `versions/`:

```text
node D:\Codex_project\AM_Core\tools\backfill-version-packages.js
```

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
