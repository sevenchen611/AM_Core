# AM-IMP-2026.0902.13 - Read-only signer inspection mode

Status: Deployed

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

PR #109 was merged as `6c90569`; Render deployment
`dep-dac1g2p5efls73a4nf4g` reached Live. Authenticated production verification
with the existing HZ-CT-001 link showed the complete signer layout, all fields
and uploads disabled, the signature canvas inert, and the submit control locked
as `檢查模式不可送出`. The contract remained `洽談中` / `已發送`; no PDF was
opened and no LINE message, signature evidence, or workflow transition was
created.
