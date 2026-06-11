# Rollback AM-IMP-2026.0611.01

Rollback should preserve data and evidence. Do not delete live project tasks unless the project owner explicitly requests deletion.

## Runtime Rollback

1. Stop loading:

```text
config/conversation-task-hierarchy-prompt.json
config/task-hierarchy-judgment-contract.json
```

2. Restore the previous flat or parent-child-only task judgment behavior.
3. Keep existing task records and evidence pages intact.

## Schema Rollback

If needed, stop writing to these fields:

```text
任務層級
阻擋母任務完成
階層判斷狀態
升級來源任務
升級後主任務
升級原因
事件線識別
完成門檻
相關任務
副任務類型
階層判斷時間
```

Do not remove fields until all project-local scripts and User UI readers no longer depend on them.

## Data Rollback

For tasks created during a failed install:

1. Mark them `封存`, not deleted.
2. Add a rollback note to the task body.
3. Preserve original source evidence.

## Manifest Rollback

Update the project-local manifest status to `Ready` or `Blocked`, depending on why the rollback happened.
