# LINE calendar preview delivery fix

Status: Deployed. Verified 2026-10-10 on the actual AM Platform service after PR #276 full CI and merge to main `aedbf53a1082fe345df32ecef262ff4f9a6755fe`. Render deploy `dep-db4soguk1f9s73dqheog` is live; production health reports that exact commit with the common archive active and ready.

Central archive's original object versus JSONB equality guard rejects optional undefined button colors before the LINE API can receive calendar preview cards. Normalize the evidence and comparison to HTTP JSON, preserving real retry-content conflicts. Dated book-club announcements now enter the same confirmed activity intake.

Real SQL/transport tests reproduce the original rejection, verify first send and equivalent retry, retain changed-payload denial, and record provider acceptance across user/group/room push and reply. 44 local tests, finance notification dry-run and full CI passed. Existing owner confirmation, binding, tenant isolation and immutable calendar retries remain enforced.

The exact-commit recovery tool resumed one original unprompted preview in the currently enrolled tenant. Read-only verification found prompted revision equal to current revision, outgoing delivery accepted and archive state done. Payload/source/revision were preserved and owner confirmation remains pending; no Google event was created by recovery. An initial broad count-only diagnostic reported an intentionally unenrolled tenant store unavailable; recovery was then scoped to every tenant listed in live configuredTenants, without granting permissions or copying settings.
