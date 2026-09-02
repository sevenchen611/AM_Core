# AM-IMP-2026.0902.06 - Personal Party A signing readiness

Engineering contracts may be initiated by either a company or an individual. A
company registration number is therefore optional for Party A and must not block
an otherwise complete individual contract from formal issuance.

This package also aligns the runtime's accepted contract evidence schema with
the already-installed v5 schema. This removes the false "signing evidence store
not ready" state while preserving compatibility with the preceding v4 schema.

The production signing switch remains an explicit operational gate. Installing
this package does not send a contract or enable outbound LINE signing by itself.
