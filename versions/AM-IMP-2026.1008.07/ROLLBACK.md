# Rollback

Disable only the target tenant's task service configuration first, preserving Calendar fields and all pending intake/task records. Restore the prior full DailyLog release using its target-private receipt and original bindings/assets. Revert the reviewed AM feature through GitHub main if required. Never deploy from a dirty or stale worktree.

The additive task intake table and nullable service configuration columns can remain. Do not drop data, restore old access state, rebind LINE owners, or delete already-issued tasks. Recovered intake must retain original event and Work IDs to avoid duplicates. Keep all private backup/configuration material at the original target.
