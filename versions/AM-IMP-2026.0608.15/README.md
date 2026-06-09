# AM-IMP-2026.0608.15 Total-Control Task Title Hygiene

This package standardizes how LINE-derived total-control task titles are written.

It prevents Notion page IDs, LINE group IDs, LINE user IDs, room IDs, message IDs, and sync IDs from appearing in human-readable `總控任務庫` task names.

## Outcome

Task titles should look like:

```text
未分類：Andy & Seven：西頭案件：補充資料評估
```

Not like:

```text
未分類：判斷 <source-page-id> 4. 餐廳...
```

## Scope

- Defines title-writing rules in AMCore.
- Updates each project's LINE message judgment script.
- Adds a project-local cleanup script.
- Cleans existing project-local total-control task titles.

Project data remains in each project and is not copied into AMCore.
