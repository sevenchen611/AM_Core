# Install

Install separately in each project. Do not copy LINE records, Notion task
records, `.env` values, tokens, customer messages, or project-local attachments
between projects.

Supported targets:

- HOZO_AM
- Seven HOZO AM
- SevenAM

## 1. Copy The Runtime Contract

Copy:

```text
versions/AM-IMP-2026.0609.02/config/thread-first-hourly-task-judgement.json
```

to the project-local config folder:

```text
config/thread-first-hourly-task-judgement.json
```

## 2. Update The Project-Local LINE Judgment Runtime

The hourly judgment runtime must follow this order:

1. Load new LINE messages.
2. Group messages by conversation.
3. Load same-conversation context.
4. Infer the project from conversation metadata before generic message text.
5. Detect and suppress assistant commands, setup messages, acknowledgements, and
   background records.
6. Apply project-local topic calibration rules when a known conversation pattern
   exists.
7. Search active total-control tasks before creating a new task.
8. Exclude archived, completed, cancelled, or deprecated tasks from matching.
9. Update an existing task when the message extends, answers, blocks, completes,
   changes, or clarifies it.
10. Create a new event-level task only when no active task can absorb it.
11. Merge duplicate candidates created in the same run.
12. Record source evidence for every task update or new task.

## 3. Add Project-Specific Calibration Rules

Each project can add its own topic rules, such as:

- vendor estimate document follow-up,
- tenant repair issue follow-up,
- meeting scheduling and attendance confirmation,
- finance or tax document requests,
- HR onboarding or offboarding evidence.

These rules must remain project-local. AMCore stores the pattern and contract,
not the live project data.

## 4. Update Project Records

After installation, update the project-local:

```text
docs/project-improvement-manifest.md
docs/upgrades/
```

Use `Installed` only after local verification passes. Use `Deployed` only after
the project-local production service has run the updated flow successfully.

