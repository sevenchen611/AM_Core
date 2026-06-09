# Rollback

Rollback is project-local.

1. Disable the updated hourly LINE judgment cron or Render job.
2. Restore the previous project-local LINE judgment script from version control.
3. Keep already-created task records for owner review. Do not bulk-delete tasks
   without project-owner approval.
4. Remove or ignore `config/thread-first-hourly-task-judgement.json` only after
   the project confirms it is returning to the previous behavior.
5. Leave this AMCore package intact so the rule history remains auditable.

