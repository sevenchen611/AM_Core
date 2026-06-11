# AM-IMP-2026.0611.01 Task Hierarchy Judgment And Promotion Prompt

This package preserves the conversation-to-task master prompt in AMCore and extends it with task hierarchy judgment, child task creation, side-task classification, and child-to-parent promotion rules.

## Purpose

AM should not flatten every conversation-derived action into one long task list.

When a conversation contains a larger outcome plus several separate action tracks, AM must decide whether each item is:

- a parent task,
- a child task that gates a parent task,
- a side task under the same project but not blocking the parent,
- an evidence-only update,
- a child task that should be promoted into a new parent task.

This package is the shared AMCore standard for that judgment.

## Scope

Included:

- the full conversation-to-task master prompt,
- the task hierarchy and promotion prompt,
- machine-readable judgment contract JSON,
- project-local Notion schema template,
- task page body template,
- install and verification rules.

Not included in this version:

- User UI manual rearrangement controls,
- drag-and-drop task hierarchy editing,
- project-specific task data migration,
- production deployment.

User UI manual organization is intentionally deferred to a later design package.

## Core Principle

A parent task is an outcome. A child task is a necessary work track that gates that outcome. A side task is related to the same project or event, but does not directly block the parent task's completion.

Do not create hierarchy for decoration. Create hierarchy only when it changes execution control.

## Relationship To Earlier Versions

This package builds on:

- `AM-IMP-2026.0608.17`: task dossier and parent-child self-relations.
- `AM-IMP-2026.0609.01`: context-first daily intake reconciliation.
- `AM-IMP-2026.0610.05`: conversation-master task intake source rule.

It does not replace those packages. It adds the judgment layer that tells AM when and how to use the existing task hierarchy.

## Main Files

- `config/conversation-task-hierarchy-prompt.json`
- `config/task-hierarchy-judgment-contract.json`
- `notion-schemas/task-hierarchy-judgment-fields.json`
- `templates/task-hierarchy-dossier.md`

## Definition Of Done

- AMCore preserves the master prompt as a reusable shared standard.
- The prompt defines parent task, child task, side task, evidence-only update, and promotion.
- The contract defines when hierarchy judgment runs.
- The contract excludes User UI manual organization from this version.
- The schema template defines fields needed to track hierarchy decisions and promotion traceability.
- The package can be installed separately into SevenAM, HOZO_AM, or future AM projects without copying project data.
