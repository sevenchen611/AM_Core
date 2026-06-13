# AM-IMP-2026.0612.13 Dashboard editing surface

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.13.md`.

## Summary

The drill-down dashboard became an editing surface: tasks can be moved between projects, organized into parent/child hierarchies (with server-side cycle protection), and fully edited (status/priority/owner/due date/next step/notes) directly from the task page without opening Notion.

## Changes

- Project view: per-task 📁 select moves the task to another official project (`POST /dashboard/assign-project`); ↳ select sets/clears the 母任務 relation (`POST /dashboard/set-parent`) with cycle protection (candidates exclude self/descendants/completed, same-project only).
- Task view: full edit panel posting to `/control/tasks/update`; notes append to the page body with timestamp+editor and write 最新備註 so hourly extraction sees them.
- Active statuses auto-set 確認狀態=已確認; 封存 leaves confirmation untouched (calibration feedback integrity).
- Conversation preview renders media: inline images, file links, and URL links from the conversation master blocks.
- Fix: `taskRow` recursion must pass all args; missing `taskById` caused 500 on projects with subtasks.

## Type

Task control UI

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

Drill-down dashboard supports moving tasks between projects, parent/child organization with cycle protection, full task editing, and conversation media preview.
