# Scoped LINE input/output gateway

Status: Installed. Production activation pending verification.

The existing OA webhook now has an opt-in external program gateway. The tenant owns its configured group and source evidence; source messages and credentials are kept in deployment PostgreSQL and secret configuration. Caller access is limited to configured groups, input users and scopes. Outputs mention a fixed configured user in the group.

The deployment uses a separate `line_io` schema and a restricted runtime role. Forced RLS permits only this tenant; no existing operational-memory business tables are changed. Transport-only groups bypass AM module processing so external programs control the response workflow.

Verified locally: nine HTTP behavior tests; PostgreSQL adapter, tenant filtering, unsend redaction, restart deduplication and leases; core routing regression. Reviewed main commits are the only production deployment source. Rollback disables `AMCORE_LINE_IO_ENABLED` and removes the transport binding, preserving stored IO evidence.

Global alignment depends on the configured legacy project folders and manifests. Record audit errors separately from this scoped deployment; no legacy project installation is claimed.
