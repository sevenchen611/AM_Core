# Install AM-IMP-2026.0612.13

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.13.md`.

## Changes To Apply

- Project view: per-task 📁 select moves the task to another official project (`POST /dashboard/assign-project`); ↳ select sets/clears the 母任務 relation (`POST /dashboard/set-parent`) with cycle protection (candidates exclude self/descendants/completed, same-project only).
- Task view: full edit panel posting to `/control/tasks/update`; notes append to the page body with timestamp+editor and write 最新備註 so hourly extraction sees them.
- Active statuses auto-set 確認狀態=已確認; 封存 leaves confirmation untouched (calibration feedback integrity).
- Conversation preview renders media: inline images, file links, and URL links from the conversation master blocks.
- Fix: `taskRow` recursion must pass all args; missing `taskById` caused 500 on projects with subtasks.

## Environment Variables (names only)

None.

## Data Isolation Check

Uses only SevenAM Notion data sources and Render service. No secrets or data copied from another project.
