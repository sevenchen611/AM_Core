# Conversation To Task Hierarchy Prompt

Canonical package:

```text
versions/AM-IMP-2026.0611.01/
```

Machine-readable prompt:

```text
versions/AM-IMP-2026.0611.01/config/conversation-task-hierarchy-prompt.json
```

Machine-readable contract:

```text
versions/AM-IMP-2026.0611.01/config/task-hierarchy-judgment-contract.json
```

## Purpose

This prompt teaches AM how to turn conversations into structured project control:

- parent tasks,
- child tasks,
- side tasks,
- evidence-only updates,
- child-to-parent promotion candidates,
- promoted parent tasks.

It preserves the successful conversation-to-task prompt discovered in SevenAM and stores it in AMCore for reuse by SevenAM, HOZO_AM, and future AM projects.

## Core Rule

AM should not create a long flat task dump.

AM should understand conversation event lines, identify project goals, create parent tasks for outcomes, create child tasks only when they gate parent completion, keep side tasks as siblings when they do not block the parent, and promote child tasks when they grow into their own outcome.

## Execution Timing

This version runs at:

- task creation time,
- hourly reconciliation time,
- meeting/report task update time.

This version intentionally does not define User UI manual rearrangement controls. That belongs to a later UI design package.

## Promotion Principle

When a child task becomes complex enough to need its own workflow, AM creates a new parent task and preserves the original child task as the promotion source.

Do not mutate the child task in place. Do not delete the source task. Keep traceability.

## Data Boundary

AMCore stores only the shared prompt, schema template, and upgrade package.

Project-local conversations, tasks, source evidence, customer data, tokens, database IDs, and production records remain in each project.
