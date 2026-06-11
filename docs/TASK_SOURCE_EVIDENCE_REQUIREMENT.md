# Task Source Evidence Requirement

This document defines the AMCore rule that every formal task must carry its
source evidence inside the project-local task database.

## Core Rule

A formal task cannot exist without cited source evidence.

When AM creates or updates a task, the task body or source/evidence fields must
include the source that explains why the task exists or why its status changed.
User UI must only render this evidence from the task database; it must not invent
or reconstruct the evidence as a separate decision layer.

## Required Evidence For New Tasks

Every newly created task must include at least one of these project-local
evidence types:

- LINE conversation reference: group or room name, message time, sender, message
  content, and media/file reference when present.
- Meeting record reference: meeting page, checkbox item, decision paragraph, or
  nearby discussion that created the action.
- Daily report clue: report slot, report time, item text, and decision trace.
- System suggestion trace: suggestion source, reasoning summary, and the source
  message or record behind the suggestion.
- Attachment or file reference: file name, source message, and linked project
  record.
- Linked source page: project-local Notion page or record that contains the
  original evidence.

## Creation Gate

Before creating a formal total-control task, the system must check:

1. Does the task have a concrete source record?
2. Is the source copied into or linked from the task body/source fields?
3. Can a project owner audit why this task exists from the task page alone?

If any answer is no, the item must not be created as a confirmed formal task.
It may be stored as a candidate task, pending-confirmation item, or judgment log
until the source is recovered.

## Update Gate

When an existing task changes status, owner, due date, next step, priority, or
scope, the update must append the evidence that caused the change.

The update evidence should state:

- where the clue came from,
- what the clue said,
- what changed on the task,
- when AM detected the change.

## Meeting Checkbox Tasks

Meeting checkbox items are confirmed task sources. The checkbox text itself is
the task content, but the task body must still include or link the meeting
record so the surrounding discussion and decisions remain available.

## User UI Boundary

User UI is a display layer. It may show source evidence, conversation excerpts,
meeting excerpts, files, and images already linked to the task, but it should not
decide whether a task has enough evidence. That decision belongs to task
creation, hourly reconciliation, meeting sync, report sync, and validation
tools.

## Validation Requirement

Each project should run a source-evidence validation check after task sync,
meeting sync, hourly LINE reconciliation, and User UI regeneration. Any task
without source evidence must be reported as a defect or candidate item that
requires source recovery.
