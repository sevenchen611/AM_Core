# Rollback — AM-IMP-2026.0828.04

Revert the runtime commit and redeploy only if the repaired permissions request
causes a regression. No schema rollback is required.

Do not delete uploaded contract files as part of rollback. If production
verification created a valid template version, preserve it as contract evidence
or archive it through the normal application workflow after project-owner
review.
