# Rollback

Revert the navigation runtime commit through reviewed GitHub main and deploy that main commit to the actual target. Remove only the journal entry import, health entry and webhook partition/handler calls. Do not re-enable the paused general assistant or modify other intake routes.

No database migration, data deletion, secret rotation or Rich Menu change is required. The Rich Menu journal entry remains usable throughout rollback. Verify target health and the original calendar/UOF routes after deploying the revert.
