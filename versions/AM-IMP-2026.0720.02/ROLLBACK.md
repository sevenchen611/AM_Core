# Rollback

Before production enablement, leave `runtimeEnabled` and `authorizationReady` as `false`; no webhook events, schedules, or Portal access will be processed for Green Hotel AM.

After enablement, set both values to `false` to stop new routing immediately. Keep the tenant-local Notion and Drive evidence intact. Do not delete conversation, task, meeting, or attachment records as part of rollback.

Remove the tenant file only after all group bindings have been disabled and an audited export/retention decision has been made.
