# AM-IMP-2026.0609.04 - Report Slot Task Snapshot Format

This package standardizes the 10:00, 13:00, and 17:00 follow-up confirmation report format for AM-style projects.

The accepted report order is:

1. Today's completed tasks.
2. Today's currently active tasks.
3. Optional goal-confirmation controls, if the project already uses a functional goal-confirmation workflow.
4. Candidate follow-up messages.
5. Unconfirmed tasks.
6. Confirmation result after write-back.

The old non-actionable `確認規則` section must not appear in the report. If a rule is only explanatory and cannot be changed, confirmed, or written back by the user, it belongs in documentation or AMCore rules, not in the scheduled report UI.

This is a shared display and report-governance improvement. It does not copy task data, LINE messages, Notion records, or secrets between HOZO AM and SevenAM.

