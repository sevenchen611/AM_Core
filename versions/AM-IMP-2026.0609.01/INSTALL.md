# Install

Install separately in HOZO_AM and SevenAM. Do not copy project data, Notion page
IDs, LINE IDs, `.env` values, Render secrets, task records, meeting records, or
message records between projects.

## 1. Copy Runtime Contract

Copy:

```text
versions/AM-IMP-2026.0609.01/config/daily-intake-reconciliation-runtime.json
```

to the project-local config folder:

```text
config/daily-intake-reconciliation-runtime.json
```

## 2. Update LINE Intake Runtime

The project-local LINE judgment script must perform this order:

1. Load new messages.
2. Group messages by conversation key.
3. Load same-conversation context.
4. Build a topic-thread judgment.
5. Search active total-control tasks before creating anything.
6. Update an existing task when a match exists.
7. Create one event-level task only when no existing task can absorb the event.
8. Mark non-actionable messages judged without creating tasks.

Exact implementation can remain project-local, but the behavior must satisfy the
contract and the verification checklist.

## 3. Keep Meeting Intake Separate

Do not weaken the meeting checkbox rule. Checkbox-derived meeting tasks remain
confirmed tasks and must deduplicate by meeting reference plus normalized task
text.

## 4. Update Project Records

After installation, update the project-local:

```text
docs/project-improvement-manifest.md
docs/upgrades/
```

Use `Installed` only after local verification passes. Use `Deployed` only after
the production Render service has been verified.

