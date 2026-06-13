# Install AM-IMP-2026.0612.16

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.16.md`.

## Changes To Apply

- Active rule in `Seven 判斷規則庫` (Applies To: SEVEN_AM, user-directed 2026-06-12): 「同一對話討論多個案件時，任務與證據必須按案件分開」.
- Applied retroactively: 仁美/大甲旅館投資評估案 split out of 溪頭 / 南投鹿谷旅館投資評估案 as a new official project; two Renmei tasks moved with parent-child relation intact and move notes appended.
- Rule injected into every extraction run via the existing Active-rules loader.

## Environment Variables (names only)

None.

## Data Isolation Check

SevenAM Notion data only.
