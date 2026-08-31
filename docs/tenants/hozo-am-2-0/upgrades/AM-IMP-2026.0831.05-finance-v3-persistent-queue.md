# AM-IMP-2026.0831.05 — Finance v3 persistent queue

Tenant: `hozo-am-2-0`
Status: Installed

Exact `請款` and `費用申請` group events are now persisted in the tenant-scoped PostgreSQL processing queue before the 葉小蝸 gateway is called. The queue uses the original LINE webhook event id as its idempotency key, recovers expired leases after process restarts, and retries downstream cold starts without producing the legacy claim form.

The fast worker runs independently from the ten-minute operational patrol. It attempts delivery for up to 70 seconds, then applies bounded retry delays. Only a terminal identity/configuration rejection or exhausted delivery budget produces a private applicant failure notice.

Local dry-runs and syntax checks pass. Keep this record at `Installed` until the AM Platform production deploy and a cold-start LINE canary both pass.
