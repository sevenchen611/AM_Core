# Install AM-IMP-2026.0610.02

1. Read `docs/TASK_SOURCE_EVIDENCE_REQUIREMENT.md`.
2. Copy the source-evidence gate into the project-local hourly reconciliation
   contract.
3. Ensure task creation and task update flows write source evidence into the
   project-local task database.
4. Regenerate User UI after task sync when needed.
5. Run:

```text
node D:\Codex_project\AM_Core\tools\validate-task-source-evidence.js
```

6. Update the project manifest and add a project-local upgrade record.

Do not copy task data, LINE messages, Notion page IDs, attachments, or secrets
between projects.
