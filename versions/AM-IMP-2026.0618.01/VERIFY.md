# Verify AM-IMP-2026.0618.01

## Local Verification

Run the target project's JavaScript syntax check:

```powershell
node --check src\dashboard-pages.js
```

Then open a local or deployed project dashboard page:

```text
/dashboard/project?name=<project-name>
```

Verify that task cards show a status dropdown.

## Functional Verification

1. Change one task status to `進行中`.
2. Confirm the page shows a saving state, then a saved state.
3. Confirm the status badge and color update without reloading the page.
4. Confirm the task record in the project-local Notion database changed to
   `進行中`.
5. Confirm the task confirmation state becomes `已確認`, if the target project
   has a confirmation-status field.
6. Change a low-risk test task to `待確認` and confirm the confirmation state
   becomes `未確認`.
7. Change a test task to `封存` and confirm the status changes while the existing
   confirmation state is not overwritten.

## Production Verification

After deployment, repeat the functional verification on the deployed dashboard.
Mark the project manifest as `Deployed` only after the live dashboard and live
Notion write have both been verified.

## Expected Result

The controller can process multiple dashboard tasks quickly from the project
page, and every save stays inside the target project's own control API and
Notion task database.
