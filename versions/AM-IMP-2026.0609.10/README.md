# AM-IMP-2026.0609.10 - Meeting-source task page evidence

This upgrade makes meeting records a first-class task-page evidence source in
AM User UI.

When a task is derived from a meeting checkbox, meeting action item, or a source
id such as `meeting:<meetingPageId>:<itemId>`, the task page must show the source
as meeting evidence. It must not fall back to generic LINE conversation wording.

Expected behavior:

- The task page source section says `資料來源：會議記錄`.
- The related page links to the source meeting record, not to a LINE group.
- The meeting name, meeting date, and useful meeting body content are shown on
  the task page when available.
- The checkbox/action item text remains visible as the task action.
- The source marker and sync id remain visible for audit.
- LINE conversation source rendering is still used for LINE-derived tasks.

This package is portable across HOZO_AM and SevenAM because it stores only the
shared source-classification rule and verifier. It does not include project
database ids, tokens, messages, meeting pages, or customer data.
