# AM-IMP-2026.0609.02 Thread-First Hourly Task Judgment

This package upgrades AM hourly LINE judgment from message-level extraction to
thread-first reconciliation.

The goal is to make the scheduled hourly process behave more like a careful
manual reread of the conversation: understand the project, read nearby context,
decide whether a message updates an existing task, and create a new task only
when the conversation contains a genuinely new event.

## Purpose

AM exists to turn real conversations into reliable project control. This version
strengthens that goal by requiring hourly task judgment to:

- infer the project from the conversation master or conversation context,
- suppress background setup messages and assistant operation commands,
- search active tasks before creating new tasks,
- never revive archived tasks as active matches,
- merge same-run duplicate candidates into one task,
- use project-specific calibration rules when a group has a known topic pattern,
- record evidence when a message updates a task.

## Why This Version Exists

Manual review was more accurate than the hourly process because manual review
read the whole discussion as one event thread. The hourly process could still
overreact to one message at a time, such as creating task fragments from group
setup messages, contact exchange, file links, or follow-up questions.

This version closes that gap by making event-thread reconciliation a required
runtime behavior.

## Portable Scope

This package is portable to:

- HOZO_AM
- Seven HOZO AM
- SevenAM

Each project must install it with its own local LINE, Notion, task database,
message database, and `.env` settings. Do not copy project data across projects.

## Relationship To Earlier Versions

`AM-IMP-2026.0608.18` defined the hourly reconciliation principle.

`AM-IMP-2026.0609.01` made context-first intake verifiable.

`AM-IMP-2026.0609.02` adds stricter task matching rules:

- archived tasks are excluded,
- same-run duplicate candidates are merged,
- project-local topic patterns can override generic keyword matching,
- background setup messages cannot absorb or create action tasks.

