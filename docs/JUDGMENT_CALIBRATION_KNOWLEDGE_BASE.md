# Judgment Calibration Knowledge Base

This document defines how AM projects collect controller feedback on assistant task judgment, turn the feedback into reusable rules, and keep project data separated.

## Purpose

The goal is to compare:

- the assistant's task judgment,
- the controller's preferred handling direction,
- the reason for the difference,
- and the reusable rule that should guide future decisions.

This is not a production task database. AMCore stores the shared process, schema, templates, and anonymized judgment rules. Each project stores its own live tasks, LINE replies, Notion page IDs, and operational records.

## Runtime Use Requirement

Calibration and manual judgment rules are not passive documentation. Before an hourly LINE task reconciliation or any task judgment run starts, each project must load the latest project-local judgment rules and apply them to task extraction, existing-task updates, status changes, progress updates, merge/suppression decisions, and no-task decisions.

The shared loading standard is:

```text
D:\Codex_project\AM_Core\docs\TASK_JUDGMENT_RULE_LOADING_STANDARD.md
```

Task creation and status updates must also follow the source-evidence gate:

```text
D:\Codex_project\AM_Core\docs\TASK_SOURCE_EVIDENCE_REQUIREMENT.md
```

No judgment rule may approve a formal task that lacks project-local source
evidence. If a task looks useful but the source cannot be attached, the correct
judgment is candidate or pending confirmation, not confirmed task creation.

## Operating Model

1. Select review candidates from a project-local total-control task database.
2. Send one task or a small batch to the controller's project-local LINE conversation.
3. The controller replies in LINE with the preferred direction and reason.
4. The project-local system updates the source task and creates or updates a judgment calibration case.
5. Repeated cases are summarized into a reusable judgment rule.
6. Stable rules are added to the task-start checklist for future assistant work.

## LINE Command Mode

Calibration should run only when the controller is available.

Project-local LINE command examples:

| Command | Meaning |
| --- | --- |
| `Seven Junior，我們開始做任務校準` | Start or resume task calibration. Send the next pending task if no item is waiting for reply. |
| `Seven Junior，任務校準暫停` | Pause calibration. Do not send another task after the current point. |
| `Seven Junior，任務校準狀態` | Report progress, including calibrated count, remaining count, and pending replies. |

When calibration is active, the controller's reply to a review item should update the current case, update the source task, extract a rule when possible, and then send the next item. When calibration is paused, ordinary LINE messages should not trigger the next calibration item.

Each review message must include progress:

```text
【判斷校準】2/80
已校準：1｜尚未校準：79
```

The numerator is the current review item. The denominator is the current calibration scope for the project-local task database.

## What To Send To LINE

Send tasks when at least one condition is true:

- the assistant confidence is low,
- the task has cross-project impact,
- the task may involve deployment, external commitments, money, legal, customer-facing messaging, or data-boundary risk,
- the task appears repeatedly but the correct handling direction is unclear,
- the task could be a real task, a note, a report signal, a responsibility item, or a project-level goal,
- the assistant's proposed action would create, close, deploy, or reassign something.

Avoid sending routine tasks that already match a stable rule unless the controller asks for full review.

## LINE Review Message Format

Each LINE review message should include:

```text
【判斷校準】{Review ID}
專案：{HOZO_AM or SEVEN_AM}
任務：{short task title}
來源：{task database / report candidate / LINE message / meeting action}

我的判斷：
{assistant proposed direction}

我判斷的理由：
{short reason}

不確定點：
{what needs controller judgment}

請回覆：
方向：{建立任務 / 不是任務 / 暫緩 / 拆任務 / 改專案 / 補資料 / 其他}
原因：{why}
規則：{optional reusable rule}
```

Do not include customer messages, secrets, tokens, production database IDs, or private attachment content in AMCore examples.

## Controller Reply Format

The preferred reply shape is:

```text
方向：...
原因：...
應更新：...
可學習規則：...
例外：...
```

Short replies are allowed. When the reply is short, the assistant should infer a draft rule and mark it as `Needs review` before using it broadly.

## Knowledge Layers

### 1. Case Log

Project-local. Stores each reviewed judgment case and links back to the source task.

Core fields:

- Review ID
- Project
- Source task
- Task type
- Assistant judgment
- Controller judgment
- Difference type
- Severity
- Confidence
- Reply summary
- Generalized rule
- Rule status
- Updated source task

### 2. Judgment Rules

Shared in shape, project-local in raw evidence. AMCore may keep anonymized stable rules.

Core fields:

- Rule name
- Trigger pattern
- Preferred judgment
- Avoided judgment
- Reason
- Applies to
- Exceptions
- Source case count
- Status
- Checklist placement

### 3. Task-Start Checklist

Stable rules should become short preflight questions, for example:

- Does this belong in AMCore, HOZO_AM, or SevenAM?
- Is this a shared upgrade package or a project-local installation?
- Is the source item a real task, a report signal, a note, a responsibility item, or a goal?
- Is the source item only an assistant operation command, such as asking Seven
  Junior or another AM assistant to show, list, search, open, or update tasks?
  If yes, keep it as a command/message log and do not create a total-control
  task. Phonetic or mistyped assistant aliases in a project assistant control
  conversation should not be treated as real people.
- Did the conversation start with a real operational check and later receive a
  short confirmation such as "normal", "no adjustment needed", or "handled"?
  If yes, treat the later message as completion evidence for the task, not as a
  reason to archive or discard the task.
- Does this require controller confirmation before sending LINE, writing Notion, deploying, or marking complete?
- Does the task body or source/evidence field include the LINE conversation,
  meeting record, report clue, system suggestion trace, attachment, or linked
  source page that caused the task or status change?
- Is any project-specific data being copied into AMCore?

## Status Values

Use these statuses for calibration cases:

| Status | Meaning |
| --- | --- |
| New | Candidate selected but not sent. |
| Sent to LINE | Sent to the controller for review. |
| Replied | Controller replied, but task/rule updates are not complete. |
| Updated | Source task has been updated. |
| Rule Extracted | A reusable rule was created or updated. |
| Archived | Kept for history, no further action. |

Use these statuses for rules:

| Status | Meaning |
| --- | --- |
| Draft | Extracted from one or few cases. |
| Needs review | Assistant inferred the rule and needs controller confirmation. |
| Active | Approved for future judgment. |
| Deprecated | No longer recommended. |

## Data Boundary

AMCore may store:

- schema templates,
- message templates,
- anonymized examples,
- generalized judgment rules,
- verification checklists.

AMCore must not store:

- live total-control task records,
- customer messages,
- LINE target IDs,
- LINE replies containing private content,
- Notion database IDs,
- tokens or secrets,
- production automation logs.

## Installation Rule

Install the calibration workflow separately into HOZO_AM and SevenAM. Each project must use its own Notion databases, LINE channel, LINE target, Render service, and environment values.
