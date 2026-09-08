# AM-IMP-2026.0908.01 — Engineering contract finalization recovery

Repairs the confirmed-to-completed Engineering contract path and removes stale
Party A assignment controls after that assignment is already complete.

The final signed-PDF request now uses a deterministic fixed-length SHA-256
idempotency key. This keeps production-length session identifiers and all three
evidence hashes inside the renderer's 240-character limit while preserving
safe retry behavior.

The contract workspace now reads the authoritative Party A assignment/signing
flags, hides the assignment control after it is no longer actionable, labels a
confirmed session as awaiting only final archival, refreshes authoritative
signing state after failed actions, and removes completion controls once the
session is completed.

This package contains no schema migration and does not alter or recreate any
signature, contract version, or evidence record.
