# AM-IMP-2026.0618.01 Dashboard project quick status update

## Summary

Adds a quick status selector to task cards on the project dashboard page:

```text
GET /dashboard/project?name=...
```

The controller can update a task's status directly from the project page without
opening the task detail page or Notion. The selector saves through the existing
project-local endpoint:

```text
POST /control/tasks/update
```

## What Changes

- Each task card on the project dashboard shows a compact status dropdown.
- Changing the dropdown saves immediately and shows `Saving...`, `Saved`, or an
  error state.
- The card status badge and color update in place after a successful save.
- Active execution statuses set the task confirmation state to confirmed.
- `待確認` sets the confirmation state to unconfirmed.
- `封存` changes only the task status and preserves confirmation state, so user
  feedback and calibration records remain trustworthy.

## Why This Matters

Project dashboards can contain many tasks. Opening each task detail page just to
change a status is slow. This improvement turns the project dashboard into a
batch control surface while keeping all writes inside the project's own Notion
task database.

## Type

Task control UI

## Portability

Portable to HOZO_AM, SEVEN_AM, and future AM projects that already have:

- `src/dashboard-pages.js`
- `POST /control/tasks/update`
- A task database with a status field and, optionally, a confirmation-status
  field.

## Project Status At Creation

- HOZO AM: Ready
- 7AM: Installed locally and pushed to GitHub in commit `988061b`; production
  deployment verification remains project-local.

## Data Isolation

This package describes code behavior only. It does not include project data,
LINE IDs, Notion data source IDs, environment values, tokens, or secrets.
