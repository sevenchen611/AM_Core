# AM-IMP-2026.0609.05 - Task deadline control standard

This upgrade makes deadline control a required part of AM task management.

Every active task should have:

- `截止日`: the date by which the task must be finished.
- `期限依據`: why that date was selected.
- `下次追蹤日`: the next date AM should check progress.
- `逾期狀態`: a visible status for deadline review.

When a conversation or meeting gives an explicit due date, project-local logic should use that date. When no explicit date exists, this upgrade uses a conservative default so the task is no longer floating without a control date.

This package does not store project data in AMCore. It provides schema, UI, install, and verification logic that must be applied separately to SevenAM and HOZO AM.
