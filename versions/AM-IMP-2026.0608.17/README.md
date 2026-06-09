# AM-IMP-2026.0608.17 Task Dossier And Subtask Hierarchy Architecture

This package standardizes how AM-style projects structure total-control tasks as execution dossiers.

## Purpose

`總控任務庫` must support more than a flat list of tasks. A parent task may require child tasks, owner handoffs, file processing, conversation follow-up, or completion checks before it can be closed.

This version defines:

- parent-child task self-relations,
- task page body dossier requirements,
- completion gates for parent tasks,
- conversation and file evidence preservation,
- project-local installation rules for HOZO AM and 7AM.

## Required Relationship

```text
總控任務庫 1 -> many 總控任務庫
```

Required fields:

- `母任務`: relation to another task in the same project-local task database.
- `子任務`: reciprocal relation showing child tasks.

This relationship is separate from the project relation introduced in `AM-IMP-2026.0608.16`.

## Required Task Page Body

Task pages should behave like work dossiers. Properties hold current state and conclusions. Body content holds the process.

Required dossier sections:

- `工作卷宗`
- `任務定位`
- `完成定義`
- `任務階層`
- `對話時間線`
- `附件與來源`
- `Codex 判斷`
- `下一步`

Child task pages should include parent link, source evidence, completion condition, and handoff back to the parent task.

## Scope

This version defines the shared architecture and installs self-relation fields into project-local Notion task databases.

It does not copy project records, source conversations, attachments, database IDs, or secrets into AMCore.
