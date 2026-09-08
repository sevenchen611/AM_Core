# AM-IMP-2026.0908.04 — Permanent LINE contract entry and final PDF

Keeps the original Engineering LINE signing invitation as the durable contract
entry point after submission and final archiving.

Every request still requires a valid LIFF identity and current membership in the
exact LINE group bound to the contract. Active designated signers keep their
existing role-specific controls. After both parties have submitted, the same
link becomes read-only; after completion it loads the private final signed PDF
instead of the original issued PDF and never exposes signing controls again.

The final artifact is loaded from the contract signing bundle, checked against
the completed session, contract, project, version and completion event, audited
as private in Drive, and SHA-256 verified before any bytes are returned.
Revoked links and incomplete sessions that expire remain unavailable.

No schema migration is required. The existing opaque token hash, signing
session, artifact record and LINE-group binding are reused without copying any
token, tenant data or secret into AMCore.
