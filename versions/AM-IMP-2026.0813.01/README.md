# AM-IMP-2026.0813.01 — Interactive LINE Task Control

This package makes a LINE task list an operational surface, rather than a
read-only report. It provides interactive Flex task cards for today's tasks,
this week's tasks, completed tasks, and task search.

Each card has two actions:

- Tap the checkbox-style completion button to complete a normal task.
- Tap the task title to open task detail and record progress, a blocker, the
  next step, or search keywords.

The LINE API does not provide a mutable native HTML checkbox. A LINE postback
is therefore used as the authoritative action, then a fresh card is returned
from the project-local task record.

## Shared contract

- `modules/task-control/` handles only recognized assistant commands and its
  own postbacks. These commands must not enter normal conversation-to-task
  extraction as real-world tasks.
- Every task query is locked to both the tenant task data source and the
  current group's `負責群組` relation.
- A completion/progress update appends an event block that states the action,
  operator, Taiwan time, group, LINE sender ID, and webhook evidence.
- A second completion click re-reads the task under a task lock and becomes a
  no-op; it must not append another completion event.
- Sensitive financial, contractual, HR, tax, legal, complaint, compensation,
  or termination-looking tasks require a confirm-complete action.

## Additive task fields

The package adds only missing fields to the target tenant's existing Tasks
data source:

| Field | Type | Purpose |
| --- | --- | --- |
| `目前進度` | rich text | Most recent work progress |
| `下一步` | rich text | Next concrete action |
| `阻礙` | rich text | Current blocker or dependency |
| `關鍵字` | multi-select | Curated search terms |
| `最近更新` | date | Most recent LINE task-control update |

Task body event blocks remain the audit source. The fields improve list and
search quality; they do not replace source evidence.

No tenant data, task records, LINE IDs, Notion IDs, tokens, or production URLs
are included in this package.
