# Meeting Checkbox Task Standard

This document defines how AM-style projects should treat checkbox items inside meeting records.

## Rule

When reviewing meeting records, every checkbox item is a task.

The text immediately after the checkbox is the task content. The project should add it directly to task tracking without asking for extra confirmation that it is a real task.

## Why

A checkbox created inside a meeting record is already an explicit action marker from the meeting context. It should not be downgraded into an uncertain candidate just because the wording does not contain action keywords such as "confirm", "follow up", or "prepare".

## Scope

Apply this rule to all project-local meeting sources, including:

- meeting page body blocks,
- meeting record fields such as `會議記錄` or `會議紀錄`,
- action item fields such as `行動項目` or `待辦事項`,
- Markdown-style checkbox lines such as `[ ] item` or `[x] item`,
- Notion to-do blocks, whether checked or unchecked.

## Tracking Behavior

For each checkbox item:

- create or update a project-local task record,
- set the task source to `會議`,
- set confirmation status to `已確認` when the project has that field,
- store the meeting page URL or page reference when available,
- keep a source excerpt that shows the meeting name and checkbox task text,
- avoid duplicates by comparing the meeting reference plus task text.

## User UI Source Display

Meeting checkbox tasks must keep the meeting record as their visible task-page
source.

Rules:

- The task page source block should say `資料來源：會議記錄`.
- The task page `關聯頁面` should link to the meeting record, not to a LINE
  conversation group.
- The task page should include the meeting name, meeting date, and useful body
  excerpt so users can understand the decision context behind the checkbox.
- The checkbox text should remain visible as the task action item.
- The task page should preserve source marker and sync id for audit.
- Do not use `來源對話群組：LINE 對話群組` as a fallback for tasks whose source
  marker or sync id identifies a meeting source.

## Confirmation Boundary

This rule only removes the extra question of whether the checkbox item is a task.

If the task content involves deployment, legal, finance, customer-facing commitments, personal data, or other high-risk execution, the project should still follow its existing approval and safety workflow before carrying out the work.

## Data Boundary

AMCore stores only this shared rule and reference implementation guidance.

HOZO_AM and SevenAM must store their own meeting pages, task records, Notion page IDs, LINE records, and environment values separately.
