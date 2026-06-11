# Verify

Run the verifier against each child project after installation:

```text
node D:\Codex_project\AMCore\versions\AM-IMP-2026.0609.10\scripts\verify-meeting-source-task-page.js D:\Codex_project\HOZO_AM\line-oa-webhook
node D:\Codex_project\AMCore\versions\AM-IMP-2026.0609.10\scripts\verify-meeting-source-task-page.js D:\Codex_project\SevenAM\line-oa-webhook
```

Manual checks:

1. Open a task page generated from a meeting checkbox.
2. Confirm the source section says `資料來源：會議記錄`.
3. Confirm the related page opens the meeting record.
4. Confirm the meeting body excerpt is visible.
5. Confirm the task page does not say
   `來源對話群組：LINE 對話群組` for the meeting-derived task.
6. Confirm normal LINE-derived task pages still show LINE conversation evidence.

Definition of done:

- AMCore documentation contains the rule.
- The package verifier passes in each installed project.
- Each project has regenerated User UI pages.
- Each project has its own manifest and upgrade note.
