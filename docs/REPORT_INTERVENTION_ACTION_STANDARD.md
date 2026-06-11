# Report Intervention Action Standard

This document defines how a controller should intervene when a scheduled report shows candidate LINE messages, meeting actions, follow-up signals, goal-recognition items, risks, or decisions.

The per-slot report generation and display rules are maintained in:

```text
D:\Codex_project\AM_Core\docs\REPORT_SLOT_RULES.md
```

The machine-readable action registry is stored at:

```text
D:\Codex_project\AM_Core\config\report-intervention-actions.json
```

## Core Principle

Every candidate item in a report must be decisionable.

The controller should not only read a candidate. The report should let the controller decide whether the candidate becomes a task, gets dismissed, gets moved to another project, receives a clearer goal, or needs the responsible owner to state the goal.

## Standard Candidate Actions

| Action | Chinese Label | Required Inputs | Result |
| --- | --- | --- | --- |
| `CREATE_TASK` | 建立任務 | Target project, task goal | Creates or links a total-control task. |
| `DISMISS_NOT_TASK` | 不是任務 | None | Marks the candidate as non-task context. |
| `CHANGE_PROJECT` | 改專案 | Target project | Reassigns the candidate to the correct project. |
| `SET_PROJECT_GOAL` | 指定專案目標 | Target project, project goal | Attaches the candidate to a project-level goal. |
| `SET_TASK_GOAL` | 指定任務目標 | Task goal | Defines the concrete outcome expected from the candidate. |
| `REQUEST_OWNER_GOAL_STATEMENT` | 要求負責人口述目標 | Owner or owner group | Sends or queues a request for the responsible owner to state the goal. |

## Candidate Record Contract

Each report candidate should carry these fields so the same action model can work across HOZO_AM and SevenAM:

| Field | Purpose |
| --- | --- |
| `candidateId` | Stable ID for the candidate decision. |
| `sourceType` | LINE message, meeting action, report follow-up, goal signal, risk, or decision. |
| `sourcePageId` | Project-local Notion source page ID. |
| `sourceText` | Short source excerpt or normalized source text. |
| `candidateSummary` | Human-readable summary shown in the report. |
| `suggestedProject` | System-inferred total-control project. |
| `suggestedProjectGoal` | Optional project goal inferred by the system. |
| `suggestedTaskGoal` | System-inferred task goal or expected outcome. |
| `suggestedOwner` | Optional owner inferred from responsibility rules. |
| `confidence` | Optional confidence score or label. |
| `decisionStatus` | Current controller decision status. |
| `allowedActions` | Which actions are valid for this candidate. |

## Decision Statuses

| Status | Chinese Label | Meaning |
| --- | --- | --- |
| `PENDING_CONTROLLER` | 待控制者確認 | Candidate is waiting for a controller decision. |
| `TASK_CREATED` | 已建立任務 | Candidate has become a total-control task. |
| `NOT_A_TASK` | 不是任務 | Candidate was dismissed as non-task context. |
| `PROJECT_REASSIGNED` | 已改專案 | Candidate was moved to another project. |
| `PROJECT_GOAL_ASSIGNED` | 已指定專案目標 | Candidate is attached to a project goal. |
| `TASK_GOAL_ASSIGNED` | 已指定任務目標 | Candidate has a task-level goal. |
| `WAITING_OWNER_GOAL_STATEMENT` | 待負責人口述目標 | Owner must state the target or completion condition. |

## Report Slot Behavior

All scheduled report slots are controller intervention windows.

| Report Slot | Main Intervention Use |
| --- | --- |
| 08:30 | Set today's project goals, task goals, and owner goal requests. |
| 10:00 | Confirm morning task candidates and dismiss noise. |
| 13:00 | Correct project assignment and clarify task goals. |
| 17:00 | Confirm follow-ups, unresolved candidates, and owner requests. |
| 20:30 | Finalize daily conclusions, unresolved tasks, risks, and next-day tracking. |

## Implementation Rule

Report UI, LINE command UI, and Notion review views should use the same action keys.

For example, a button labeled `建立任務` in a report and a LINE command that means "create this candidate as a task" should both write the action key `CREATE_TASK`. This keeps later automation from depending on display text.

## Data Boundary

AMCore defines the action contract only.

Each project must store its own report candidates, source messages, controller decisions, task records, and owner requests in its own Notion databases.
