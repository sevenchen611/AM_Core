# Verify AM-IMP-2026.0608.11

Run these checks separately in HOZO_AM and SevenAM after installation.

## Local Verification

1. Open a report that contains at least one candidate item.
2. Confirm the candidate exposes all six standard actions:
   - `建立任務`
   - `不是任務`
   - `改專案`
   - `指定專案目標`
   - `指定任務目標`
   - `要求負責人口述目標`
3. Choose `不是任務` on a test candidate and confirm it records `DISMISS_NOT_TASK` and `NOT_A_TASK`.
4. Choose `改專案` on a test candidate and confirm the target project override is recorded.
5. Choose `指定任務目標` and confirm the task goal is recorded.
6. Choose `建立任務` only on a safe test candidate and confirm the resulting task is linked back to the candidate.
7. Confirm the report remains readable after decisions are saved.

## Data Boundary Verification

- HOZO_AM writes only to HOZO_AM databases.
- SevenAM writes only to SevenAM databases.
- No token, secret, customer message, task record, or report record is copied into AMCore.

## AMCore Package Check

From AMCore:

```text
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0608.11
```

## Alignment Check

After both projects install the version:

```text
node D:\Codex_project\AM_Core\tools\compare-project-manifests.js
node D:\Codex_project\AM_Core\tools\audit-alignment.js
```

