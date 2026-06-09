# Install

Install separately in HOZO AM and 7AM.

## 1. Identify Project-Local Task Database

Find the target project's own:

- `總控任務庫`

Do not use another project's data source ID.

## 2. Add Task Self-Relation

Add these fields to the project-local `總控任務庫`:

```text
母任務 = relation to the same 總控任務庫
子任務 = reciprocal relation from the same 總控任務庫
```

Recommended Notion schema intent:

```text
ADD COLUMN "母任務" RELATION('<project task data source id>', DUAL '子任務' 'children')
ADD COLUMN "子任務" RELATION('<project task data source id>', DUAL '母任務' 'parent')
```

Use the exact syntax supported by the Notion schema tool in the project environment.

## 3. Link Existing Parent And Child Tasks

For each meaningful parent task:

1. Identify child tasks that directly gate completion of the parent task.
2. Set each child task's `母任務` relation to the parent task.
3. Confirm the parent shows the reciprocal `子任務` relation.
4. Keep sibling tasks under the same `總控專案` relation when they do not directly gate the parent task.

## 4. Update Task Pages

For each meaningful parent task, add dossier body sections:

```text
工作卷宗
任務定位
完成定義
任務階層
對話時間線
附件與來源
Codex 判斷
下一步
```

For child tasks, include:

- parent task link,
- child task purpose,
- source conversation or file,
- completion condition,
- current judgment,
- handoff back to parent task.

## 5. Update Project Records

Update:

- `docs/project-improvement-manifest.md`
- `docs/upgrades/`

Mark `Installed` only after the self-relation exists in that project's own task database.
