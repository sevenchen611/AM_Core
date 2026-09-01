# Rollback

1. Roll back only the runtime code to the previous deployed commit.
2. Preserve all immutable contract versions, exclusion records, and Drive files created while this package was active.
3. Do not restore an excluded file by rewriting an old version; create a new version that explicitly includes the intended source file.
4. Re-run protected attachment and cumulative-inheritance checks before redeployment.
