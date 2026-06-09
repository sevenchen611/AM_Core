# Install AM-IMP-2026.0608.11

Install this version separately in each target project.

Do not copy HOZO_AM report data into SevenAM, or SevenAM report data into HOZO_AM.

## 1. Copy The Action Registry

Copy this package contract into the project runtime config:

```text
versions\AM-IMP-2026.0608.11\contracts\report-intervention-actions.json
```

Recommended target path inside each project:

```text
config\report-intervention-actions.json
```

## 2. Add Or Confirm Project-Local Notion Fields

For the database or table that stores report candidates, report snapshots, or pending candidate decisions, add the fields described in:

```text
versions\AM-IMP-2026.0608.11\notion-schemas\report-intervention-fields.json
```

Use project-local databases only.

## 3. Update Report Rendering

For every candidate item shown in 08:00, 10:00, 13:00, 17:00, and 20:30 reports, render these actions:

1. `建立任務`
2. `不是任務`
3. `改專案`
4. `指定專案目標`
5. `指定任務目標`
6. `要求負責人口述目標`

The display text can be Chinese, but the saved action key must be the canonical key from the registry.

## 4. Update Decision Handling

When a controller chooses an action:

- Write the action key.
- Write the decision status.
- Write any override fields required by the action.
- Link the source candidate to the resulting task, progress report, or owner-goal request when one is created.

## 5. Update Project Records

After verification, update the target project's:

```text
docs\project-improvement-manifest.md
docs\upgrades\
```

Use status `Installed` only after local verification succeeds.

