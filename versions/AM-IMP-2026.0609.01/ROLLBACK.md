# Rollback

Rollback is project-local.

1. Disable the updated LINE judgment cron or Render job.
2. Restore the previous project-local LINE judgment script from version control.
3. Keep already-created task records for controller review; do not bulk-delete
   production tasks without project-owner approval.
4. Remove or ignore `config/daily-intake-reconciliation-runtime.json` only after
   the project confirms it is returning to the previous behavior.
5. Leave AM_Core package files intact so the rule history remains auditable.

