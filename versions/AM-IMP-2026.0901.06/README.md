# AM-IMP-2026.0901.06 — Finance Claim source-group entry and fast delivery

This package returns the Finance Claims v3 entry link to the originating, allowlisted LINE group instead of privately messaging the applicant.

The signed entry remains applicant-bound: another group member who opens the URL cannot complete LINE Login as the original applicant. Successful entry creation and LINE delivery now complete under one durable queue lease, while the database idempotency key, provider-delivery ledger, uncertain-delivery reconciliation and retry states remain intact. Entry commands begin at the authoritative web-entry check because LINE already supplied the configured group and submitter; join/leave membership events continue to use the membership-sync path.
