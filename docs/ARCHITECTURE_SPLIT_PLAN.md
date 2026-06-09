# AM Core Architecture Split Plan

## Feasibility

The proposed split is feasible and recommended, but it should be done in stages.

The correct target structure is:

```text
AM_Core
  Shared AM logic, upgrade packages, schema templates, install tools, verification tools

HOZO_AM
  HOZO-specific .env, LINE, Notion, Render, GitHub, project manifest, upgrade records

SevenAM
  Seven-specific .env, LINE, Notion, Render, GitHub, project manifest, upgrade records
```

## Why Not Split Immediately

HOZO_AM and SevenAM are currently not at the same version state.

If AM_Core is extracted before both projects are aligned, the extraction may accidentally freeze one project's newer behavior while missing another project's installed improvement.

Therefore, first make the version history complete and comparable. Then extract the shared code.

## Phase 1: Package The Versions

Convert each reusable improvement into a complete upgrade package under:

```text
D:\Codex_project\AM_Core\versions\AM-IMP-YYYY.MMDD.NN\
```

Each package must include:

- Human-readable install instructions
- Machine-readable `upgrade.json`
- Required database schemas
- Required environment variables
- Scripts to install or verify the version
- Project separation rules
- Verification checklist
- Rollback notes

## Phase 2: Bring Projects To Version Parity

For each package:

1. Install into HOZO_AM using only HOZO_AM settings.
2. Install into SevenAM using only SevenAM settings.
3. Update each project's own manifest.
4. Mark the shared registry status only after local project records agree.

## Phase 3: Extract The Shared Code

Only after both projects have the same core capabilities:

1. Identify code files that are identical or should become identical.
2. Move shared logic into `AM_Core\core`.
3. Replace project-specific code with adapter/config loading.
4. Keep each project-specific `.env`, Render setup, Notion IDs, and LINE credentials outside AM_Core.

## Phase 4: Future Project Installation

New AM projects should be created by:

1. Copying or referencing AM_Core.
2. Creating a new project folder.
3. Creating project-local `.env`.
4. Creating project-local Notion databases.
5. Installing required upgrade packages in order.
6. Deploying the project's own Render service.

