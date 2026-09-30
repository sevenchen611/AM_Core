# Rollback

Restore the previous UOF build first so it no longer sends `inline:true`, then
revert the gateway change and deploy that reviewed revision. The older gateway
accepts the existing non-inline action payloads. No database or key rollback
is required.
