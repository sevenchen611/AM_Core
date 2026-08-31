# Rollback

1. Revert the AM Platform runtime commit and redeploy.
2. If an immediate fail-closed stop is required, set `HZ2_FINANCE_CLAIMS_V3_GROUP_ENTRY_ENABLED=false`.
3. Do not delete `am_memory.processing_jobs` or tenant data. Jobs of kind `finance_claim_v3_group_entry` can remain for audit and do not affect the prior runtime.
4. Before re-enabling, inspect queued, retry, leased, and dead-letter rows for the tenant so no accepted LINE event is silently abandoned.
