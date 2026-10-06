# Rollback

Before reverting code, explicitly switch the pilot back with `mode: group`, the
current expected direct conversation and owner, and the original group id.
The endpoint rechecks owner identity and the group's exclusive membership and
updates the same binding atomically. Confirm the consumer caches the restored
binding, then clear its pilot configuration. All other accounts remain intact.

Do not restore old encrypted snapshots over a running worker. Do not roll the
gateway back while an active binding uses a U-id: old code assumes group keys.
The original group must still contain only the pilot and the OA before restore.
