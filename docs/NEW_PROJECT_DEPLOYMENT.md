# New AM Project Deployment From AMCore

This is the procedure for standing up a **third (or later) AM user/project** —
for example a new business unit assistant alongside SevenAM and HOZO_AM —
directly from AMCore.

AMCore is the version master. A new project is created by installing AMCore's
packaged versions in order into a fresh, project-owned runtime. AMCore never
holds the new project's secrets or data.

## Principle

- AMCore owns: shared code, schemas, upgrade packages, version state, tooling.
- The new project owns: its own `.env`, LINE channel, Notion workspace,
  Render service, GitHub repo, and all customer/task data.
- Copy code and schema from AMCore. Never copy secrets or data from SevenAM,
  HOZO_AM, or any other project.

## Step 0 — Register The New Project

1. Pick a project key, e.g. `THIRD_AM`, and a display name.
2. Add it to [`config/projects.json`](../config/projects.json) with its own
   `localPath`, `manifestPath`, `upgradeRecordsPath`, and a `dataBoundary` line.
3. Create the project's own repo/folder with an empty
   `docs/project-improvement-manifest.md` (copy the header from an existing
   project manifest) and an empty `docs/upgrades/` folder.

## Step 1 — Seed The Runtime

1. Start from [`core/runtime-template`](../core/runtime-template) as the base
   runtime, or from the latest project that is closest to current.
2. Replace every project-specific value with the new project's own:
   - `HOZO_*` / `SEVEN_*` environment variable names → `THIRD_*`
   - hard-coded display names, Notion parent checks, report category rules,
     and Render service names.
3. Provide the new project's own `.env` (never copied from another project).

## Step 2 — Install Versions In Order

Install AMCore packages from oldest to newest so dependencies are satisfied.
The current target head is shown in [`../VERSION.md`](../VERSION.md)
(`latestTrackedImprovement`).

For each version in `versions/` (sorted ascending):

1. Read the package: `README.md`, `INSTALL.md`, `VERIFY.md`, `upgrade.json`.
2. Check `upgrade.json.dependsOn` (if present) is already installed.
3. Apply `INSTALL.md` using the new project's credentials only.
4. Create any `requiresDatabases` in the new project's Notion workspace.
5. Set any `requiresEnv` names in the new project's environment.
6. Run `VERIFY.md` checks.
7. Record the result in the new project's manifest and a new upgrade record.

Use the standard install request in
[`INSTALL_VERSION_WORKFLOW.md`](INSTALL_VERSION_WORKFLOW.md) per version. Some
early versions are foundational (data isolation guard `AM-IMP-2026.0608.01`,
manifest/records `AM-IMP-2026.0608.05`) and should be installed first.

## Step 3 — Confirm Parity

1. Run `node tools/build-amcore-version.js` — the new project should appear in
   the Project Heads table once its manifest exists, with its head approaching
   `latestTrackedImprovement`.
2. Run `node tools/compare-project-manifests.js` to see the new project's
   column next to HOZO_AM and SevenAM.
3. Run `node tools/audit-alignment.js` to catch missing rows or syntax errors.

## Step 4 — Production

1. Deploy the new project's own Render service with its own environment.
2. Mark versions `Deployed` in the new project's manifest only after production
   verification (see status meanings in `INSTALL_VERSION_WORKFLOW.md`).

## Backfilled Packages Note

Packages for `AM-IMP-2026.0612.*` and `AM-IMP-2026.0613.*` were backfilled into
AMCore from the production projects' authoritative upgrade records (see each
package's `upgrade.json` → `backfill`). Their `INSTALL.md` describes the changes
to reproduce; when installing into a new project, also consult the cited source
record if a step needs more detail.
