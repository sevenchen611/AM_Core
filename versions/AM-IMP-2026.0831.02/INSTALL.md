# Install

1. Deploy the updated contract management service, workflow API, PostgreSQL adapter, draft-review service, and Engineering AM workspace.
2. No database migration or environment-variable change is required.
3. Existing `internal_review` versions become eligible for the new `return-draft` transition.
4. Existing version content, draft-review history, hashes, and signing evidence remain unchanged.
5. Do not copy Engineering contract data into another tenant.
