# Rollback

Set the production `AMCORE_LEAF_CALENDAR_ENABLED=0` and restart the reviewed main service to stop this feature's intake/worker. Alternatively revert the reviewed code commit through main. The general AM private assistant remains paused, and UOF/group routes are unaffected.

Keep the tenant-local tables and evidence for audit or later recovery; do not drop them or delete Google events automatically. Revoke the dedicated key in the owner's DailyLog account if the integration should lose Google access. Existing calendar events remain in Google until their owner explicitly changes or removes them.

When re-enabling, preserve frozen confirmed JSON/request IDs. Do not swap IDs after timeout or idempotency conflict. After channel-secret rotation, create fresh pairings because encrypted keys use the former secret.
