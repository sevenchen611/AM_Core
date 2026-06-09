# Required Databases

| Logical Database | Purpose |
| --- | --- |
| Responsibility | Stores one row per responsibility item or task owner decision. |
| LINE Group Options | Stores project-local LINE groups available for owner narrowing. |
| LINE Group Members | Stores project-local known members per LINE group. |

## Required Fields

Responsibility:

- `權責項目名稱`
- `第一層：總控專案`
- `第二層：主要對話群組`
- `第三層：主要負責人`
- `選擇狀態`
- `候選群組數`
- `候選負責人數`
- `LINE對象ID（結果）`
- `選擇說明`
- `更新時間`

Group options:

- `群組名稱`
- `總控專案`
- `LINE群組ID`

Group members:

- `成員名稱`
- `對應群組`
- `LINE使用者ID`

