# Install AM-IMP-2026.0618.01

Install this package into one AM project at a time. Keep each project's Notion
data sources, LINE channel, Render services, and secrets separate.

## Preconditions

The target project should already have:

- A dashboard renderer in `src/dashboard-pages.js`.
- A task update endpoint equivalent to `POST /control/tasks/update`.
- A project dashboard route equivalent to `/dashboard/project?name=...`.
- Existing task status values such as `待確認`, `未開始`, `進行中`, `等待回覆`,
  `待確認完成`, `已完成`, and `封存`.

No new environment variables or Notion databases are required.

## Changes To Apply

1. In the project dashboard task-card renderer, add a status dropdown beside the
   existing task controls.
2. Give the dropdown enough context to save:
   - Task page ID
   - Current status
   - Status options
   - Optional confirmation mapping
3. In the dashboard page script, listen for dropdown changes and call:

```text
POST /control/tasks/update
```

with a JSON body similar to:

```json
{
  "pageId": "<project-local task page id>",
  "status": "進行中",
  "confirmation": "已確認",
  "editedBy": "Seven 陳聖文"
}
```

4. Use this confirmation mapping:
   - `待確認` -> `未確認`
   - `未開始`, `進行中`, `等待回覆`, `待確認完成`, `已完成` -> `已確認`
   - `封存` -> do not send a confirmation value
5. Update the status badge and visual state in place after a successful save.
6. Show a clear error message and restore the previous dropdown value if the save
   fails.

## Files Usually Changed

- `src/dashboard-pages.js`

Project-local manifest and upgrade note files should also be updated after the
install.

## Do Not Copy

- `.env`
- `env.txt`
- LINE user IDs or group IDs
- Notion database IDs
- Render service IDs or URLs
- Task data from another project
