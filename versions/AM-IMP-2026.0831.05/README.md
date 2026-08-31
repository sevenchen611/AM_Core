# AM-IMP-2026.0831.05 — Durable Finance Claims v3 group ingress

Finance Claims v3 group commands are persisted before delivery to the 葉小蝸 gateway. The AM Platform reuses the tenant-scoped `am_memory.processing_jobs` table, leases due work with `FOR UPDATE SKIP LOCKED`, and retries cold-start or transient gateway failures without falling back to the legacy claim form.

The LINE webhook still returns immediately. A successful downstream acceptance publishes the existing v3 group card; a terminal or exhausted failure privately notifies only the applicant. The original LINE webhook event id is the end-to-end idempotency key.
