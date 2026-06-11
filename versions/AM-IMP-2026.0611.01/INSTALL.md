# Install AM-IMP-2026.0611.01

Install separately into each project-local AM repo. Do not copy live task, conversation, customer, or token data into AMCore.

## 1. Copy Shared Config

Copy these files into the project-local config folder:

```text
versions/AM-IMP-2026.0611.01/config/conversation-task-hierarchy-prompt.json
versions/AM-IMP-2026.0611.01/config/task-hierarchy-judgment-contract.json
```

Recommended project-local paths:

```text
config/conversation-task-hierarchy-prompt.json
config/task-hierarchy-judgment-contract.json
```

## 2. Add Or Verify Task Database Fields

The project-local total-control task database should already have the `AM-IMP-2026.0608.17` self-relations:

```text
母任務
子任務
```

Add the additional fields from:

```text
notion-schemas/task-hierarchy-judgment-fields.json
```

Minimum required additions:

```text
任務層級
阻擋母任務完成
階層判斷狀態
升級來源任務
升級後主任務
升級原因
事件線識別
完成門檻
```

Optional but recommended:

```text
相關任務
副任務類型
階層判斷時間
```

## 3. Runtime Loading Rule

Before any project-local script creates or updates tasks from conversations, meetings, reports, or controller suggestions, it must load:

```text
config/conversation-task-hierarchy-prompt.json
config/task-hierarchy-judgment-contract.json
```

The contract must be considered during:

- initial task creation,
- hourly LINE reconciliation,
- meeting checkbox task creation,
- report-derived task update,
- promotion suggestion or promotion execution.

Do not add User UI manual organization behavior in this package.

## 4. Child Task Creation Behavior

When a larger outcome has multiple required work tracks:

1. Create or update the parent task.
2. Create each gating work track as a child task.
3. Link each child task to the parent through `母任務`.
4. Mark whether each child blocks parent completion through `阻擋母任務完成`.
5. Preserve source evidence in both parent and child task bodies.

## 5. Promotion Behavior

When a child task grows into its own outcome:

1. Create a new parent task.
2. Link the new parent through `升級來源任務`.
3. Mark the original child task as `已升級來源`.
4. Link the original child task to `升級後主任務`.
5. Preserve the original parent relation as historical context unless the project owner later reorganizes it.

Do not silently overwrite or delete the original child task.

## 6. Manifest Update

After local installation, update the project-local manifest:

```text
docs/project-improvement-manifest.md
docs/upgrades/UPGRADE-YYYY-MM-DD-AM-IMP-2026.0611.01.md
```

Use `Installed` only after local verification passes.
