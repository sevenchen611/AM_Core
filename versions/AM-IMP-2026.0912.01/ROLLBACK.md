# Rollback

1. Set `claims.authorityRegistry.mode` to `off` in the target project's local configuration.
2. Remove the lifecycle and authorization calls from that project's runtime only if they cannot remain dormant safely.
3. Keep the PostgreSQL tables and outbox records for auditability; do not delete production authorization history as part of rollback.
4. Mark the target project's own upgrade record `Blocked` or `Deprecated` with the rollback reason.
5. Stop the claims-authority outbox worker and unmount the admin routes. Do not
   drop roles, tables, event receipts, audit rows, or encrypted identities.

Disabling the feature returns to the existing V3/legacy feature gate without deleting history.
