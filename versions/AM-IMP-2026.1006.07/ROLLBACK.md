# Rollback

Set AMCORE_LEAF_CALENDAR_ENABLED=0 on the bot deployment and redeploy reviewed main to stop intake and workers. UOF and other independent services keep their existing routes. Revert the runtime feature through a reviewed PR if needed. Keep tenant-local durable evidence and frozen requests for audit; do not delete these rows to retry, change IDs or create duplicates after uncertain writes. Revoking UOF binding also blocks that actor's further intake/writes.

The shared service key lives encrypted in the tenant database and in the administrator's private DailyLog file, never in Git. Rotate/revoke it in DailyLog when necessary, then reinstall the replacement bot configuration. Rotating the LINE channel secret requires reinstallation because stored service ciphertext is bound to it. This feature does not delete already-saved Google events; cancellation only applies to uncommitted drafts.
