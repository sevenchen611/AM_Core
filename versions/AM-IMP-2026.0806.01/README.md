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
card. Non-construction tenants keep their existing reminder-link behavior.
