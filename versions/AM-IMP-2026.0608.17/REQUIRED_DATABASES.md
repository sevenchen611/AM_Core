# Required Databases

| Logical Database | Purpose |
| --- | --- |
| Total Control Task | Execution task database that supports parent-child task hierarchy. |

## Total Control Task Required Fields

- Title field, commonly `任務名稱`
- `狀態`
- `確認狀態`
- `下一步`
- `負責人`
- `來源`
- `來源原文`
- `總控專案` relation to the project database
- `母任務` self-relation to the parent task
- `子任務` reciprocal self-relation showing child tasks

## Compatibility Fields

The following may remain during migration:

- `專案`
- `第一層：總控專案`
- `對應總控專案`

They should not be treated as the long-term source of truth when formal relations exist.
