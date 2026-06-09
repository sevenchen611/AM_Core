# Verify

Run these checks in each target project after installation.

## AMCore Package Check

```text
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0608.13
```

## Local Project Checks

1. Confirm both project-local Notion databases exist.
2. Confirm the data source IDs are stored only in the project environment.
3. Confirm the LINE review target is project-local.
4. Confirm the review message does not include secrets, production database IDs, customer records, or private attachment content.

## Dry-Run Review

Create a fake or sanitized task candidate and generate a review message.

Expected result:

- The message includes review ID, project, task title, assistant judgment, reason, uncertainty, and reply instructions.
- The message does not include private project data.
- No source task is changed during dry run.

## LINE Send Test

Send one sanitized review message to the controller's project-local LINE target.

Expected result:

- The controller receives the review message.
- The outgoing message is stored only in the project-local records.
- AMCore receives no LINE target ID, reply text, or task record.

## LINE Command Test

Send these commands in the target project's LINE conversation:

```text
Seven Junior，我們開始做任務校準
Seven Junior，任務校準狀態
Seven Junior，任務校準暫停
```

Expected result:

- Start creates or resumes an active calibration session.
- Start sends only one pending review item at a time.
- Each review item shows `{current}/{total}`, calibrated count, and remaining count.
- Status reports calibrated, remaining, and waiting-for-reply counts.
- Pause prevents ordinary replies from triggering the next review item.
- No LINE user ID, token, or production database ID is copied into AMCore.

## Reply Update Test

Reply in LINE using the controller reply format.

Expected result:

- The project-local calibration case status changes from `Sent to LINE` to `Replied` or `Updated`.
- The source task receives the controller direction.
- A judgment rule is drafted when the reply contains a reusable pattern.

## Rule Extraction Test

Convert one reviewed case into a rule.

Expected result:

- The rule has trigger pattern, preferred judgment, avoided judgment, reason, applies-to, exceptions, and status.
- If the assistant inferred the rule, status is `Needs review`.
- If the controller approved the rule, status is `Active`.

## Alignment Audit

After project manifests have a row for this package, run:

```text
node D:\Codex_project\AMCore\tools\audit-alignment.js
```

If this repository is checked out as `AM_Core`, run the same script from the actual local path:

```text
node D:\Codex_project\AM_Core\tools\audit-alignment.js
```
