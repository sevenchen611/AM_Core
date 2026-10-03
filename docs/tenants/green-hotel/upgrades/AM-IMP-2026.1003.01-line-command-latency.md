# Personal LINE command latency

Status: Deployed. Reviewed PR 218 was merged as `ccc911d` and verified in the
production health response on 2026-10-03; the subsequent `f7c629e` also includes it.

The transport parallelizes fresh identity, exclusive count and owner membership
checks, shares only overlapping read proofs, removes a redundant Push member
lookup and resolves groups with bounded concurrency. No completed authorization
cache is used. Reply, Push, capture and binding mutations remain fresh; member
events and current database status stop suspended or revoked access.

The regression suites use synthetic messages, users, keys and local databases.
Read-only event polling fell from approximately 1.1 seconds to 0.3–0.4 seconds.
Real command latency still requires separate measurement of the complete path.
No real approval or production message was sent during verification.
