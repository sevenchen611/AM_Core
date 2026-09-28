# Rollback

Revert through a reviewed main PR. Keep processing_jobs rows and their evidence;
do not delete or rewrite queued/succeeded bank replies. A code rollback disables
this worker, so queued rows require manual attention until it is restored.
Rental's additive receiver and audit records remain compatible with older AM.
Never roll back by deploying a local branch or replaying financial events.
