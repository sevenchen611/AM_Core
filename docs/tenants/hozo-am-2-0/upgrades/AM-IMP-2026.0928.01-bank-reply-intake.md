# Bank reply intake

Installed locally on 2026-09-28. See
`versions/AM-IMP-2026.0928.01/` for installation, verification and rollback.

Verified offline: PostgreSQL full-envelope persistence and tenant isolation,
immutable duplicates, receiver timeout and restart recovery, fenced expired
leases, retained dead letters, webhook ACK ordering, reviewer rejection audit,
short acknowledgements and financial match guards. Existing claims authority,
bank mentions and collector isolation checks passed.

The legacy alignment audit was attempted. Its configured standalone checkout
paths under `D:\Codex_project` are unavailable on this host, producing missing
package/manifests findings unrelated to this root-only adapter. Alignment with
those standalone projects is not claimed; no path or legacy manifest was
changed to conceal the findings. The new package completeness check passed.

Production status remains pending until both companion main commits are live.
No test LINE message or historical financial replay is part of verification.
