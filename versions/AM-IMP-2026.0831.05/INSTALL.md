# Install

1. Confirm the tenant has operational memory enabled, a tenant UUID, and access to the existing `am_memory.processing_jobs` schema.
2. Deploy the updated AM Platform runtime.
3. Keep the existing Finance Claims v3 gateway URL, token, and group-entry enable flag.
4. Do not add a new database or copy production credentials; the queue uses the tenant's declared operational-memory connection and forced RLS context.
5. Verify the fast scheduler is running every five seconds and the ordinary ten-minute patrol remains unchanged.
