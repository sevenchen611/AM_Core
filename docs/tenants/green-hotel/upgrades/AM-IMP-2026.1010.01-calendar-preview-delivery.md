# LINE calendar preview delivery fix

Status: Ready. Local regression verified; production deployment pending review.

Central archive's original object versus JSONB equality guard rejects optional undefined button colors before the LINE API can receive calendar preview cards. Normalize the evidence and comparison to HTTP JSON, preserving real retry-content conflicts. Dated book-club announcements now enter the same confirmed activity intake.

Real SQL/transport tests reproduce the original rejection, verify first send and equivalent retry, retain changed-payload denial, and record provider acceptance. Existing owner confirmation, binding, tenant isolation and immutable calendar retries remain enforced. No production messages or calendar entries were created during this investigation. Existing unprompted drafts can resume their scheduled retry after reviewed deployment.
