# Rollback

1. Redeploy the commit immediately before this package.
2. Do not alter contract-version rows, review records, or signing evidence during rollback.
3. A version already returned to `draft` remains valid under the existing lifecycle rules; resubmit it through the prior workflow if required.
4. No database rollback is required.
