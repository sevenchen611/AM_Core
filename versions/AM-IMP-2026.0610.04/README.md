# AM-IMP-2026.0610.04 - Exclude archived tasks from User UI

This package makes archived total-control tasks disappear from daily User UI task surfaces.

The User UI task list is an operating view, not the historical archive. Tasks whose status is `封存`, `已封存`, or `Archived` must stay in the project-local Notion task database for audit history, but they must not be imported into generated User UI task lists or task-page output.

## Scope

- All tasks list.
- Project task lists.
- Generated task detail pages.
- User UI task counts and status filters.

## Data Boundary

AMCore stores only this rule, generator behavior, package metadata, and verification script. Live task records stay inside each project's own Notion workspace and generated project folder.

