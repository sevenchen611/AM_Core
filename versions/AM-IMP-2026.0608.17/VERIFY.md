# Verify

Verify separately in each project.

## Schema Checks

- `總控任務庫` has a relation field named `母任務`.
- `總控任務庫` has the reciprocal relation field named `子任務`.
- Both fields point only to the same project-local task database.
- Existing project relation fields from `AM-IMP-2026.0608.16` remain available.

## Record Checks

- Open a known parent task.
- Confirm it shows child tasks through `子任務`.
- Open a child task.
- Confirm it points back to the parent through `母任務`.
- Confirm sibling tasks are not incorrectly nested under the parent.

## Dossier Checks

Open a meaningful parent task and confirm the body includes:

- completion definition,
- task hierarchy,
- conversation or meeting timeline,
- attachments and source pages,
- current judgment,
- next step,
- transfer, pause, cancellation, or completion reason when applicable.

Open a child task and confirm the body includes:

- parent task link,
- source evidence,
- completion condition,
- handoff back to the parent.

## Data Isolation Checks

- HOZO AM self-relations point only within HOZO AM `總控任務庫`.
- 7AM self-relations point only within 7AM `總控任務庫`.
- No project records, source conversations, or attachments are stored in AMCore.
