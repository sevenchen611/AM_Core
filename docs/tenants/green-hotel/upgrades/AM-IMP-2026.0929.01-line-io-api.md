# Scoped LINE input/output gateway

Status: Deployed. Verified 2026-09-29.

The existing OA webhook now has an opt-in external program gateway. The tenant owns its configured group and source evidence; source messages and credentials are kept in deployment PostgreSQL and secret configuration. Caller access is limited to configured groups, input users and scopes. Outputs mention a fixed configured user in the group.

The deployment uses a separate `line_io` schema and a restricted runtime role. Forced RLS permits only this tenant; no existing operational-memory business tables are changed. Transport-only groups bypass AM module processing so external programs control the response workflow.

Verified locally: nine HTTP behavior tests; PostgreSQL adapter, tenant filtering, unsend redaction, restart deduplication and leases; core routing regression. Reviewed main commits are the only production deployment source. Rollback disables `AMCORE_LINE_IO_ENABLED` and removes the transport binding, preserving stored IO evidence.

Global alignment depends on the configured legacy project folders and manifests. Record audit errors separately from this scoped deployment; no legacy project installation is claimed.

## Production verification

- Reviewed and merged PR #203; deployed main commit `7109caf9d2d5e85692bbdfcc505f58463e9954b0`. Render deploy `dep-dati46e0tbcc73fvsol0` is Live, and /health reports that commit with lineIo.enabled=true.
- LINE provider webhook endpoint test returned success=true and statusCode=200.
- Authenticated groups and events returned 200; the group list matched the configured group, input user and notification user. Empty input cursor remained 0 as expected before a new user message.
- No bearer key returned 401; sending to another group returned 403 without push.
- The authorized deployment canary was accepted with two LINE message IDs (@notification and report). Repeating identical body and idempotency key returned the same accepted request and message IDs with replayed=true. These are provider acceptance receipts, not proof of read or approval.
- Actual user-message input canary is pending the user's reply in the configured group. No synthetic source message was inserted into production. Postbacks and media were tested locally only.
- Caller handoff, fixed IDs, API key and provider receipts are kept in the caller project/private configuration, outside AMCore source.
