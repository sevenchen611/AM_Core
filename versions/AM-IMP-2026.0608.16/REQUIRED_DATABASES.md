# Required Databases

| Logical Database | Purpose |
| --- | --- |
| Total Control Project | Top-level project/case dossier database. |
| Total Control Task | Supporting execution task database. |

## Total Control Project Required Fields

- Title field, commonly `專案名稱`
- `目標`
- `成功條件`
- `目前進度摘要`
- `下一步`
- `主要風險`
- `狀態`
- `負責人`
- `關聯任務` relation from the task database

## Total Control Task Required Fields

- Title field, commonly `任務名稱`
- `狀態`
- `確認狀態`
- `下一步`
- `負責人`
- `來源`
- `來源原文`
- `總控專案` relation to the project database

## Compatibility Fields

The following may remain during migration:

- `專案`
- `第一層：總控專案`
- `對應總控專案`

They should not be treated as the long-term source of truth.
