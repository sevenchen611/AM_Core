# Task Dossier Architecture

`總控任務庫` is not only a flat to-do list. It is the execution dossier layer under `總控專案庫`.

Each task page should explain:

- what action must be completed,
- which project goal it supports,
- which child tasks must close before the parent task can close,
- which conversations, files, meetings, and reports explain the work,
- how AM judged the task status, owner, risk, and next step.

## Parent And Child Tasks

The task database must support self-relations:

```text
總控任務庫 parent task -> child tasks in the same 總控任務庫
```

Required relation fields:

- `母任務`: relation to the parent task in the same task database.
- `子任務`: reciprocal relation showing tasks that support the parent.

A child task is used when completing one task requires another track of work, another owner, another attachment processing step, or another decision before the parent can be closed.

Do not use child tasks for every related item. If an item belongs to the same project but does not directly gate the parent task, keep it as a sibling under the same project instead.

## Parent Completion Gate

A parent task should not be marked complete just because one conversation had a partial answer.

Before closing a parent task, AM should check:

- all required child tasks are complete, cancelled, transferred, or explicitly no longer needed,
- missing information has been supplied or the reason for stopping is recorded,
- source evidence exists in the parent or child task body,
- sensitive or external-commitment closures have owner confirmation.

If some child tasks are done but the parent still has unresolved requirements, keep the parent as `進行中`, `等待回覆`, or `待確認完成`.

## Task Page Body

Properties summarize current state. The page body preserves the process.

Recommended sections:

- `工作卷宗`
- `任務定位`
- `完成定義`
- `任務階層`
- `對話時間線`
- `附件與來源`
- `Codex 判斷`
- `狀態變更紀錄`
- `下一步`

For child tasks, use the same structure at a smaller scale:

- parent task link,
- child task purpose,
- source conversation or file,
- completion condition,
- current judgment,
- handoff back to parent task.

## Source Evidence

Task pages should keep or link the evidence that explains the status.

Valid evidence includes:

- LINE conversation pages,
- individual source message pages,
- attachments and file pages,
- meeting records,
- daily reports and follow-up reports,
- controller decisions,
- system suggestions that led to task creation or status changes.

When a task is derived from a conversation thread, preserve the thread-level story, not only one source sentence. Include what changed, what was answered, what remains missing, and what later messages closed or redirected.

## Data Boundary

AMCore stores this architecture, schema pattern, and templates only.

Project-local tasks, conversations, files, attachments, and task body records must stay in each project's own Notion workspace and databases.
