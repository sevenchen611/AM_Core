# Claim form availability

This session owns tenant-scoped form availability in core/claims-authority.js and core/claims-authority-admin.js, startup schema in modules/claims/authority-integration.js, and related tests/upgrade package. Preserve group assignments, versions, submitted claims and historical receipts. HOZO retired employee_expense cannot be re-enabled; other tenants retain existing V3 behavior. Legacy forms can be disabled and enabled by authorized managers. No finance writes, LINE delivery, or other-tenant configuration changes.

PR #24 modifies legacy claim accounting; this change owns only availability and selection routing. Rebase before merge and preserve its changes if merged first.
