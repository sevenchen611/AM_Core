# Total-Control Task Title Rules

Human-readable task titles must not contain technical IDs.

The machine-readable rule registry is stored at:

```text
D:\Codex_project\AM_Core\config\total-control-task-title-rules.json
```

## Rule

When generating a task in a project-local `總控任務庫`, the task title should help the controller understand the work immediately.

Do not put these values in `任務名稱`:

- Notion page IDs
- LINE group IDs
- LINE room IDs
- LINE user IDs
- LINE message IDs
- Sync IDs

Keep those values in source, URL, relation, or debug fields instead.

## Preferred Format

```text
專案：對話顯示名稱：可行動主旨
```

Examples:

```text
未分類：Andy & Seven：西頭案件：補充資料評估
營運：Andy & Seven：安排現場查看時間
```

## Traceability

Technical values are still useful, but they belong in fields such as:

- `來源原文`
- `關聯 Notion 頁面`
- LINE message relation fields
- conversation relation fields
- sync/debug fields

The operator-facing title should stay clean.

