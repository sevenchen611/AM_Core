# AM-IMP-2026.0609.01 Context-First Daily Intake Reconciliation

This package turns the hourly LINE reconciliation rule from a documented policy
into an implementation contract for the 08:00 daily intake and the 08:00-22:00
hourly checks.

## Purpose

The daily intake must not create one task per message fragment. Before creating
a new total-control task, the project-local runtime must decide whether the new
LINE message is:

- an update to an existing task,
- evidence for a task status change,
- background for an existing topic,
- a command or low-signal message that should not create a task, or
- a genuinely new event-level task.

Meeting records remain a separate intake path: checkbox items are confirmed
meeting tasks, while surrounding meeting discussion is preserved as execution
knowledge and status-change evidence.

## Required Runtime Behavior

For LINE intake:

1. Load new LINE messages for the run window.
2. Group messages by project-local conversation key.
3. Load same-conversation context before judging each message.
4. Split context into topic threads, not isolated message lines.
5. Search active total-control tasks by project, conversation, people, dates,
   subject keywords, source evidence, and open status.
6. Prefer updating an existing task when the new message answers, clarifies,
   blocks, completes, changes, or extends that task.
7. Create a new task only when no active task can absorb the event and the
   event has a real action, owner, delivery, decision, risk, or follow-up need.
8. Mark command, acknowledgement, duplicate, test, pure knowledge, and background
   messages as judged without creating tasks.
9. Record evidence for every update or new task.

For meeting intake:

1. Extract checkbox items as confirmed tasks.
2. Deduplicate by meeting reference plus normalized task text.
3. Preserve the surrounding meeting discussion as task knowledge/evidence.
4. Use project-local exclusion rules, such as reading-club internal learning
   rules, before writing new total-control tasks.

## Relationship To AM-IMP-2026.0608.18

`AM-IMP-2026.0608.18` defines the hourly reconciliation rule. This version adds
the stricter runtime contract needed to verify that the implementation actually
follows the rule.

