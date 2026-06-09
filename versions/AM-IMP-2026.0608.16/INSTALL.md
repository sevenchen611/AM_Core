# Install

Install separately in HOZO AM and 7AM.

## 1. Identify Project-Local Databases

Find the target project's own:

- `總控專案庫`
- `總控任務庫`

Do not use another project's data source IDs.

## 2. Add Formal Task-To-Project Relation

Add this field to the project-local `總控任務庫`:

```text
總控專案 = relation to project-local 總控專案庫
```

Use a reciprocal relation field on the project database:

```text
關聯任務
```

## 3. Keep Compatibility Fields

Do not immediately delete existing select fields such as:

```text
專案
第一層：總控專案
對應總控專案
```

These fields may be used by existing reports, scripts, or views during migration.

## 4. Backfill Existing Records

For each active project:

1. Find tasks whose legacy `專案` select matches the project name.
2. Set the new `總控專案` relation to the matching project row.
3. Review duplicate or merged tasks before linking.
4. Leave uncertain tasks unlinked and mark them for controller review.

## 5. Update Project Pages

For each meaningful project page, add dossier body sections:

```text
案件卷宗
這個專案如何完成
支撐任務
案件過程紀錄
附件與來源
目前判斷
下一步
```

The body should preserve the process. Properties should summarize the state.

## 6. Update Project Records

Update:

- `docs/project-improvement-manifest.md`
- `docs/upgrades/`

Mark `Installed` only after the schema relation exists in that project.
