# Rollback

Rollback should disable the review workflow without deleting historical controller decisions.

## Steps

1. Stop any scheduler or command that selects judgment review candidates.
2. Disable LINE review sending for this package.
3. Keep the project-local calibration case database for audit history.
4. Keep the project-local judgment rules database, but mark untrusted rules as `Deprecated` if they should no longer guide future work.
5. Remove or ignore project-local environment values for calibration data sources only after confirming no active workflow needs them.
6. Update the project manifest from `Installed` or `Deployed` to `Ready`, `Blocked`, or `Deprecated` as appropriate.

## Do Not Delete

Do not delete source tasks, controller replies, or historical calibration cases unless the project owner explicitly requests a project-local data cleanup.

Do not copy any rollback data into AMCore.
