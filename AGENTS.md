# AMCore Agent Guide

AMCore is the shared core and upgrade-package center for AM-style projects such as HOZO_AM and SevenAM.

This repository is not a production LINE bot by itself. It stores shared architecture rules, reusable runtime templates, upgrade packages, package templates, and alignment tools.

## Main Rule

Use AMCore to design, package, document, and verify shared improvements.

Apply improvements to HOZO_AM and SevenAM separately.

Do not mix project data.

## Ultimate AM Goal

AM exists to help turn real-world conversations into reliable project control.

The most important purpose of AM, SevenAM, HOZO_AM, and AMCore development is:

1. Find meaningful tasks from conversations.
2. Connect every task to a project goal.
3. Use meeting records as both task sources and execution knowledge.
4. Track whether tasks have moved, changed, been blocked, or been completed.
5. Preserve the source evidence behind every task and status change.

Every AMCore shared feature, runtime template, upgrade package, script, schema,
report, and assistant workflow should serve this goal. If a proposed improvement
does not make conversation-to-task extraction, project-goal alignment, meeting
knowledge reuse, or task status tracking clearer and more reliable, treat it as
secondary to this goal.

### 1. Core Task: Extract Action Items

AM must continuously look for reasonable tasks in LINE conversations and other
project conversations.

Rules:

- A LINE group is a context container. It may contain one continuous project
  discussion, or several separate topic threads in the same day.
- Before creating tasks, split a conversation into topic threads by subject,
  participant replies, time continuity, explicit topic changes, and phrases such
  as "another thing" or "insert one more issue".
- Judge tasks at the topic-thread level, not at the single-message level. Several
  messages may together form one task, one status update, or one completed issue.
- If a later message in the same topic thread answers the earlier question,
  provides the requested data, confirms transfer, or closes the loop, update the
  existing task status and evidence instead of creating another task.
- Extract tasks when a conversation implies an action, follow-up, decision,
  unresolved issue, delivery promise, blocker, owner responsibility, or
  completion check.
- Do not extract assistant operation commands as tasks. Messages such as
  "查待辦", "列出今天的待辦", "打開第 2 個任務", "看一下目前任務",
  or similar instructions addressed to Seven Jr., HOZO Jr., AM, or another
  assistant are system operations, not new real-world tasks. Preserve them as
  source messages or command logs when needed, but do not create total-control
  tasks from them unless the same message also contains a separate concrete
  action, owner, delivery, deadline, or external commitment.
- Each task should connect back to a project goal. A task without a project goal
  is incomplete context, not a fully understood control item.
- If a conversation reveals a new project goal, first record or propose the
  project goal, then organize the related tasks underneath that goal.
- If a task is useful but the project goal is unclear, keep it as a candidate
  task and mark what needs clarification instead of ignoring it.
- When one conversation contains multiple tasks or multiple goals, split them
  into separate task records where practical.
- The task record should preserve source context: original message, conversation
  or meeting reference, project guess, reason for extraction, and any inferred
  owner, due date, priority, or risk.

Project-goal linkage:

- A project goal explains why the task matters and what larger outcome it serves.
- A new project goal may appear as a stated objective, milestone, deadline,
  requested result, recurring concern, or repeated cluster of related tasks.
- Existing project assignment from a project-local conversation master should
  override text guessing when available.
- AMCore may define the shared logic and schema pattern, but each project must
  store its own live goals, tasks, messages, and records locally.

### 2. Meeting Records As Task And Knowledge Sources

Meeting records are a first-class intake source, not a secondary note archive.

Task definition:

- In meeting records, every checkbox item is a task.
- The content immediately after the checkbox is the task content.
- Checkbox-derived meeting tasks do not need extra confirmation that they are
  real tasks because the meeting record already marked them as action items.
- This applies to Notion to-do blocks and Markdown-style checkbox lines such as
  `[ ] item`, `[x] item`, `□ item`, `☐ item`, `☑ item`, and `✅ item`.
- Checkbox tasks should enter the project-local task database with source set to
  meeting. When the task schema has confirmation status, use confirmed status.
- Avoid duplicates by matching the meeting reference plus normalized task text.

Reference-document role:

- Meeting discussion, decisions, progress notes, blockers, and conclusions are
  important knowledge sources for task execution.
- Do not only extract the checkbox text and discard the rest of the meeting.
  Preserve or link the surrounding discussion so the executor can understand why
  the task exists, what was decided, what has already changed, and what risk or
  dependency was mentioned.
- Meeting decisions can explain project-goal changes, task priority changes,
  ownership changes, due-date changes, or completion criteria.
- Meeting records may update project progress reports even when they do not
  create a new task.

### 3. Task Status Tracking And Updates

AM must use later conversations, meeting records, daily reports, and system
suggestions to detect whether a task has been handled, blocked, changed, or
completed.

Rules:

- Track task status from LINE conversations, meeting records, daily reports,
  follow-up confirmations, and system-generated suggestions.
- If a later source indicates a task has moved forward, changed owner, changed
  due date, become blocked, been partially handled, or been completed, update the
  project-local task record.
- Status changes must be grounded in source clues. Do not silently mark a task
  complete based only on optimism or lack of recent discussion.
- Record the status-change evidence inside the task body or source/evidence
  field: where the clue came from, what it said, what status changed, and when it
  was detected.
- Keep the raw source message or meeting reference linked so the project owner
  can audit why the status changed.

Valid evidence sources include:

- System suggestions that identify a likely status change or follow-up result.
- Daily report contents, including morning brief, follow-up reports, and the
  daily control report.
- A later LINE conversation where someone says the item was handled, answered,
  scheduled, sent, paid, reviewed, blocked, cancelled, or completed.
- A meeting record that records a decision, completion, blocker, reassignment,
  or next step for the same task.

Status update behavior:

- If evidence shows completion, move the task toward completed or pending
  completion confirmation depending on risk and confidence.
- If evidence shows waiting on someone, mark that the task is waiting and record
  who or what is being waited on.
- If evidence shows work started but not finished, mark that it is in progress
  and add the current next step.
- If evidence is plausible but uncertain, keep the task pending confirmation and
  write the evidence summary for project-owner review.
- Sensitive, financial, contractual, legal, HR, tax, or external commitment
  items still require project-owner confirmation before final closure or external
  action.

### 4. Hourly LINE Task Reconciliation

From 08:00 through 22:00 in each project-local timezone, AM's hourly LINE check
has one central duty: decide whether each new LINE message is an update to an
existing task or a genuinely new event that needs a new task.

This hourly check exists because the full cause-and-effect chain of a task often
lives inside the LINE group history. A later message may answer an earlier
question, provide requested data, confirm attendance, show that someone joined a
group, prove that a reply was sent, change the owner, reveal a blocker, or close
the loop. AM must therefore reconcile messages against existing tasks before it
creates new tasks.

Hourly reconciliation flow:

1. Read new LINE messages since the previous hourly run.
2. For each message, review earlier context in the same LINE conversation.
3. Search the project-local total-control task database for related active tasks.
4. If the new message extends, answers, completes, blocks, changes, or clarifies
   an existing task, update that task and record the evidence.
5. If no existing task can absorb the message, decide whether it is a new event.
6. Create a new task only when the new event contains a real action, owner,
   delivery, decision, risk, or follow-up need.
7. If the message is background, acknowledgement, duplicate content, test text,
   pure knowledge sharing, or a record with no action, mark it judged without
   creating a task.

The task database should remain an event-control system, not a message-to-task
dump. The shared machine-readable contract for this behavior is:

```text
versions/AM-IMP-2026.0608.18/config/hourly-line-task-reconciliation.json
```

## Project Roles

| Project | Role |
| --- | --- |
| AMCore | Shared core source, upgrade packages, templates, audit tools. |
| HOZO_AM | HOZO production project with its own LINE, Notion, Render, GitHub, and `.env`. |
| SevenAM | Seven production project with its own LINE, Notion, Render, GitHub, and `.env`. |

## Data Boundary

Never store these in AMCore:

- `.env`
- LINE tokens or channel secrets
- Notion tokens
- Render secret values
- GitHub tokens
- Production database IDs as required shared values
- Customer messages
- Task records
- Report records
- Attachment records
- Automation logs

AMCore may store:

- Shared code patterns
- Runtime templates
- Script templates
- Notion schema templates
- JSON package metadata
- Upgrade instructions
- Verification checklists
- Rollback notes
- Non-secret project path configuration

## Standard Workflow

For any shared feature change:

1. Create or update an Upgrade Package in `versions/AM-IMP-YYYY.MMDD.NN/`.
2. Include `README.md`, `upgrade.json`, `INSTALL.md`, `VERIFY.md`, and `ROLLBACK.md`.
3. Add scripts, JSON files, schema files, or reference code when the version needs them.
4. Keep project-specific values out of the package.
5. Install the package into HOZO_AM and SevenAM separately.
6. Update each project's own `docs/project-improvement-manifest.md`.
7. Create each project's own `docs/upgrades/` record.
8. Run the AMCore alignment audit.

## Required Checks

Before calling alignment complete, run:

```text
node D:\Codex_project\AMCore\tools\audit-alignment.js
```

For a single package, run:

```text
node D:\Codex_project\AMCore\tools\check-upgrade-package.js AM-IMP-YYYY.MMDD.NN
```

For version status comparison, run:

```text
node D:\Codex_project\AMCore\tools\compare-project-manifests.js
```

## Runtime Template

The current shared runtime starting point is:

```text
D:\Codex_project\AMCore\core\runtime-template
```

This is not yet a fully generic production runtime. Before turning it into a real shared runtime, remove or adapt project-specific names such as HOZO, Seven, `HOZO_*`, and `SEVEN_*`.

## Production Deployment

AMCore does not deploy production services.

Deploy each project from its own project folder:

- HOZO_AM deploys to the HOZO Render service.
- SevenAM deploys to the Seven Render service.

Do not mark a version as `Deployed` unless that project's own production Render service has been verified.

## Status Values

Use only these values in manifests and registries:

| Status | Meaning |
| --- | --- |
| Proposed | Idea exists, not ready to install. |
| Ready | Package/spec is ready but not installed in this project. |
| Installed | Applied and verified locally. |
| Deployed | Applied and verified in production. |
| Blocked | Cannot proceed without missing project-local setup or permission. |
| Deprecated | No longer recommended. |

## Working Style

When asked to improve shared behavior, do not only write a note.

Build the package, include the needed scripts/schema/JSON, install it separately into each project when requested, and verify with the audit tool.
