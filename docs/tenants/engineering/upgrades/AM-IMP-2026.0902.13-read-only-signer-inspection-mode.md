# AM-IMP-2026.0902.13 - Read-only signer inspection mode

Status: Installed

## Engineering installation

- A verified current member of the contract's bound LINE group receives a
  read-only inspection view of the complete signer layout.
- The view shows where the signer fills counterparty details, uploads both
  identity-card sides, gives consent, signs in the large box, and submits.
- Every write control is disabled and the signature canvas is inert.
- The server still requires the designated signer's LINE identity before any
  signature or identity evidence can be stored.
- Inspection does not reproduce another person's live screen or partially
  entered browser-local values.

## Verification boundary

Local signing and signing-web tests cover the inspection access mode, visible
guidance markers, and server-side non-signer rejection. Production deployment
and authenticated inspection using the existing contract link are pending.

