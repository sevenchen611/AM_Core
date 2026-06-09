# AM-IMP-2026.0608.18 Hourly LINE Task Reconciliation

This package defines the core hourly duty for AM-style projects between 08:00
and 22:00 local project time.

## Purpose

Every hourly LINE check is not merely a message classifier. Its central job is
to decide whether each new LINE message is:

- an update to an existing task,
- evidence that an existing task changed status,
- background for an existing event,
- a duplicate or low-signal message that should be ignored, or
- a genuinely new event that needs a new task.

The goal is to keep the total-control task database as an event-control system,
not a message-to-task dump.

## Core Loop

For every hourly run from 08:00 through 22:00:

1. Read new LINE messages since the previous run.
2. Load the earlier conversation context for the same LINE group, room, or user.
3. Search the total-control task database for related active tasks.
4. Decide whether the new message extends, updates, completes, blocks, or
   changes an existing task.
5. Update that task with evidence when a match exists.
6. If no existing task can reasonably absorb the message, decide whether it is
   a new event.
7. Create a new task only for a new event that has a real action, owner,
   delivery, decision, risk, or follow-up need.

## Required Spec

The shared machine-readable spec is:

```text
config/hourly-line-task-reconciliation.json
```

Project-local installations may copy this spec into their own `config/` folder
and adapt only names, environment variable prefixes, or schedule labels. They
must not copy project messages, task records, tokens, or Notion data source IDs
into AMCore.

