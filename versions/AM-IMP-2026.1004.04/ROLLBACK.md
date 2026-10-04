# Rollback

Rollback reviewed runtime code through a new main commit and verify production.
Keep additive schema fields, queued jobs and Drive originals; never delete retained
files or source messages. Reconcile pending jobs before rolling back the worker.

The old runtime does not consume the durable queue and restores the known loss
condition outside Engineering. Treat it as degraded. Historical missing originals
remain missing; never mark them saved during rollback.
