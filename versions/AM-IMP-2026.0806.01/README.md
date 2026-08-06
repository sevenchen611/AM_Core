# Engineering mobile task cards

This package changes engineering task reminders from dashboard deep links to focused,
mobile-first task cards. A signed-in AM Portal user can read the task origin and full
development history, append a handling record, upload supporting images, and update the
task status without a Notion account.

Notion remains the engineering tenant's structured storage and audit trail. Every update
is appended to the original task page with the verified Portal actor and Taipei timestamp.
Changing a task to `完成` requires a written completion result. Uploaded images are attached
as Notion image blocks and receive fresh temporary display URLs whenever the card reloads.

The engineering dashboard remains available only as a secondary link at the bottom of the
card. Previously sent `/dashboard?doc=...` reminder links redirect to the same task card,
so old LINE messages gain the new workflow too. Non-construction tenants keep their existing
reminder-link behavior.

Meeting-origin tasks show the meeting date and title together with a clickable public meeting
record link. LINE origins display the bound group name instead of the internal LINE group ID.
The card resolves these labels from the task's Notion relations, with legacy source-text lookup
as a fallback for previously created tasks.
