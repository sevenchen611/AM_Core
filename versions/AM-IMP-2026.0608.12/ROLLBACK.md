# Rollback

If the upgraded cron sender behaves incorrectly:

1. Restore the previous project-local `scripts/render-cron-report.js`.
2. Remove or ignore the `AM_CRON_*`, `AM_PROJECT_ENV_PREFIX`, and `AM_CONTROL_HEADER_PREFIX` cron env values.
3. Keep `CONTROL_API_URL`, `CONTROL_LINE_PUSH_URL`, and the project-local control key unchanged.
4. Trigger one safe report test from the target project only.
5. Update the project manifest status to `Blocked` or restore the previous status until the issue is fixed.

Rollback does not require deleting Notion data, LINE records, Render services, or AMCore package files.
