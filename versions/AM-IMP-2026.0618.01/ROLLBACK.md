# Rollback AM-IMP-2026.0618.01

## Safe Rollback

Revert the project-local `src/dashboard-pages.js` changes that added:

- The project-page quick status dropdown.
- The dropdown change listener.
- The quick-save state labels.
- The quick-status CSS rules.

Then redeploy or restart the target project service.

## Data Considerations

This upgrade does not add databases, environment variables, or persistent queue
tables. Rollback does not require schema cleanup.

If a task status was changed accidentally during verification, restore that task
manually in the project-local Notion task database or from Notion page history.

## Manifest Status

After rollback, update the project-local `docs/project-improvement-manifest.md`
row to `Rolled back` or `Disabled`, and add the rollback date and reason in the
verification column.
