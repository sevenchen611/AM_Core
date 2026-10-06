# Rollback

Revert the reviewed commit that introduced this package and redeploy the resulting reviewed main commit through the target service's workflow. Re-run private routing and task-control checks and verify the actual deployed revision.

Rollback resumes the previous one-to-one assistant behavior, including task commands and the capabilities guide. Alternatively, restore `PERSONAL_ASSISTANT_ENABLED=true` through a reviewed main commit and verify enabled-mode routing. No data migration or task deletion is needed.
