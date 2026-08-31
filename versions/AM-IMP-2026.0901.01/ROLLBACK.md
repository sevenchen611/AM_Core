# Rollback

1. Set `HZ2_FINANCE_CLAIMS_V3_GROUP_ENTRY_ENABLED=false` to stop accepting new local Finance v3 commands.
2. Revert the AM Platform runtime commit and redeploy through the normal `main` workflow if code rollback is required.
3. Restore the prior Rental gateway upstream only if the former service is healthy and explicitly re-enabled as the sole drainer.
4. Do not delete Finance Claims v3 ingress, workflow, delivery or Rental notification-outbox rows. Inspect pending and uncertain rows before any re-enable operation.
