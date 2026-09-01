# AM-IMP-2026.0901.06 — Finance Claim source-group entry and fast delivery

Status: Installed

The HOZO Finance Claims v3 entry link now targets the originating allowlisted group binding. The signed URL remains bound to the applicant identity verified by LINE Login, so group visibility does not grant another member the applicant's session.

The normal entry path now creates the Rental URL and dispatches it to LINE under one durable queue lease. Idempotency, database persistence, provider acknowledgement, uncertain-delivery reconciliation and retry behavior are unchanged. A production canary is required before this record becomes `Deployed`.
