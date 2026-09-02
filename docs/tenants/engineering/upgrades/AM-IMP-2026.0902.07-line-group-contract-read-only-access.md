# AM-IMP-2026.0902.07 - LINE group contract read-only access

Status: Installed

## Engineering installation

- The formal signing link verifies LIFF identity and current membership in the
  contract's bound Engineering LINE group.
- Every verified current group member may open the exact frozen PDF.
- Only the designated signer sees the counterparty, identity-document,
  signature, consent, and submission controls.
- Server-side submission repeats the signer check before storing any signature
  or identity evidence.
- A read-only viewer does not change signing status or create the designated
  signer's first-open evidence.

## Verification boundary

Local signing, web, runtime, and security-gate dry-runs pass. Production
deployment and live-link verification are pending. No new LINE invitation is
required because an existing unexpired protected link uses the updated runtime
authorization after deployment.
