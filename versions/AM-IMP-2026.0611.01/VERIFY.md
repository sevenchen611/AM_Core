# Verify AM-IMP-2026.0611.01

## AMCore Package Verification

Run:

```text
node D:\Codex_project\AMCore\tools\check-upgrade-package.js AM-IMP-2026.0611.01
```

## Project-Local Verification

For each installed project:

1. Confirm the task database still has `母任務` and `子任務`.
2. Confirm the new hierarchy fields exist:
   - `任務層級`
   - `阻擋母任務完成`
   - `階層判斷狀態`
   - `升級來源任務`
   - `升級後主任務`
   - `升級原因`
   - `事件線識別`
   - `完成門檻`
3. Confirm task creation scripts load both JSON config files.
4. Run a dry-run conversation rebuild and confirm output contains:
   - parent tasks,
   - child tasks,
   - side tasks,
   - promotion candidates,
   - suppressed/evidence-only updates.
5. Confirm no task is created without source evidence.
6. Confirm User UI manual organization controls were not added by this package.

## Scenario Tests

Use test conversations or dry-run fixtures:

### Parent With Children

Input:

```text
We need to evaluate a hotel investment case.
Ask the broker for documents.
Ask the broker to arrange an owner meeting.
Ask the broker to come discuss the case.
```

Expected:

- One parent task for the investment evaluation outcome.
- Three child tasks under the parent.
- Each child has owner/next-step/evidence.
- Parent completion is blocked until child tasks close or are cancelled.

### Side Task

Input:

```text
Also save the PDF for reference.
```

Expected:

- If saving the PDF does not gate the parent outcome, classify as side task or evidence-only update.
- Do not nest it as a blocking child unless it is required for evaluation.

### Promotion

Input:

```text
The broker documents now require separate title deed, lease, revenue data, owner price, and finance model analysis.
```

Expected:

- Original child task becomes promotion source.
- New parent task is created for broker document acquisition.
- New child tasks are created under the new parent.
- Promotion source and new parent are linked.

### Sensitive Promotion

Input:

```text
This child task now involves contract terms, investment decision, tax, HR, or legal exposure.
```

Expected:

- Create a promotion candidate or pending-confirmation item.
- Do not auto-finalize external action without owner confirmation.
