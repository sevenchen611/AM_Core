# Rollback

1. Disable the payment-control routes and any associated worker before
   redeploying the previous runtime.
2. Do not drop, truncate, or rewrite payment items, claims, evidence, or audit
   events. They are legal and financial control evidence.
3. Retain the immutable contract-version snapshots and all event hashes.
4. Any in-progress claim remains visible as read-only until the Engineering
   finance owner decides its next action.
5. Re-enable only after the owner has reviewed the incident, reconciled
   idempotency records, and confirmed that no external payment was initiated.
