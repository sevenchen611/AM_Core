# Verify

Run verification separately in each project.

## Static Verification

From AM_Core:

```text
node versions/AM-IMP-2026.0609.02/scripts/verify-thread-first-task-judgement.js D:\Codex_project\SevenAM\line-oa-webhook
node versions/AM-IMP-2026.0609.02/scripts/verify-thread-first-task-judgement.js D:\Codex_project\HOZO_AM\line-oa-webhook
```

Run the Seven HOZO AM path separately when that project folder is available.

The verifier checks for these implementation signals:

- same-conversation context loading,
- conversation-level project inference,
- operation/setup message suppression,
- active task search before creation,
- archived task exclusion,
- contextual task matching,
- same-run duplicate candidate merge,
- task update evidence.

## Behavioral Verification

Use dry-run mode before production writes.

Required test cases:

| Case | Expected Result |
| --- | --- |
| Later message provides a requested file or data | Existing task is updated with evidence. |
| Later message asks for missing documents in the same event thread | One follow-up task is created or updated. |
| Two consecutive messages ask for parts of the same missing-data set | One task is created, then updated; no duplicate task. |
| Contact exchange, group setup, acknowledgement, or assistant command | Judged without task creation. |
| Archived task has the same title as a candidate | Archived task is not updated; a new active task may be created if needed. |
| New unrelated event appears in the same group | A separate event-level task is created. |

## Completion Criteria

- Dry-run output separates updated existing tasks from created tasks.
- A known project conversation can be reconciled without creating setup-message
  task fragments.
- No archived task is selected as an active related task.
- No duplicate cluster is created from one topic thread in the same run.
- Production is not marked `Deployed` until the project-local scheduled service
  has run the updated flow successfully.

