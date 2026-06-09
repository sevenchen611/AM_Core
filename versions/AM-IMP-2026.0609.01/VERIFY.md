# Verify

Run verification separately in each project.

## Static Verification

From AM_Core:

```text
node versions/AM-IMP-2026.0609.01/scripts/verify-line-reconciliation-implementation.js D:\Codex_project\SevenAM\line-oa-webhook
node versions/AM-IMP-2026.0609.01/scripts/verify-line-reconciliation-implementation.js D:\Codex_project\HOZO_AM\line-oa-webhook
```

The static verifier checks for the minimum implementation signals:

- same-conversation context is loaded,
- active total-control tasks are searched,
- existing tasks can be updated,
- task creation is not the first write path,
- no-task / judged-without-task outcomes exist,
- meeting checkbox sync remains present.

## Behavioral Verification

Use a no-send or dry-run mode first.

Test cases:

| Case | Expected Result |
| --- | --- |
| Later message answers an earlier question | Existing task is updated with evidence. |
| Later message confirms meeting time or attendance | Existing meeting/scheduling task is updated. |
| Long pure knowledge explanation | Message is judged without creating many tasks. |
| LINE assistant command asking for task list | Command is handled or queued, not created as total-control task. |
| New external commitment or financial risk | One new event-level task is created or confirmation is requested. |
| Meeting checkbox line | Confirmed meeting task is created once; rerun skips duplicate. |

## Completion Criteria

- The run output reports updated existing tasks separately from newly created
  tasks.
- No duplicate cluster is created from one topic thread.
- Source evidence is written on every task update and every new task.
- Production is not marked `Deployed` until the project-local Render service has
  run the updated flow successfully.

