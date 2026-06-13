# Rollback AM-IMP-2026.0613.03

This package was backfilled, so rollback is described generically.

- Revert the commit(s) that applied this version in the target project.
- Restore the previous values of any environment variables introduced by this version.
- If a database column or table was added, keep it (additive) or drop it only after
  confirming no other version depends on it.
- Mark the version as rolled back in the target project's improvement manifest.

## Source Status Note

Installed on the worker machine for both projects; Render-side cron deletion confirmed by the user during sync. SevenAM commits 9a4a90a/bb02ce2; HOZO commit f5f1d66.
