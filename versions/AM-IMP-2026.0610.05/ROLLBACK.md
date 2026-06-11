# Rollback AM-IMP-2026.0610.05

Rollback should restore project behavior without deleting evidence.

## Steps

1. Restore the previous project-local scripts and Render cron commands.
2. Remove group member index sync from scheduled flows if it causes runtime failure.
3. Restore the previous User UI generator and regenerate User UI.
4. Restore the previous daily report preview generator if needed.
5. Redeploy the target project's own Render service.

## Do Not Delete

Do not delete:

- LINE conversation master pages.
- LINE raw message log pages.
- total-control tasks.
- progress reports.
- attachment records.
- group member index records.
- generated reports needed for audit.

## Safe Partial Rollback

If only the group member index fails, keep conversation-led task judgement active and disable only the member-index sync path.

If only User UI rendering fails, keep runtime judgement active and restore only the previous User UI generator.

If production deploy fails, keep local files and revert only the Render service to the last known working deployment.

