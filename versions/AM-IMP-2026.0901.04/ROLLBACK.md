# Rollback

Revert the package commit through a pull request and redeploy GitHub `main` through Render.

No schema or data rollback is required. Rolling back restores the previous five-minute validation ceiling, so it must be paired with a Rental rollback to a source-hint lifetime of at most five minutes.
