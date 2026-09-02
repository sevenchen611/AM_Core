# AM-IMP-2026.0902.07 - LINE group contract read-only access

Status: Deployed

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

Local signing, web, runtime, and security-gate dry-runs pass. PR #99 was merged
at commit `314930b`; Render deployment `dep-dabvaruq1p3s739pt40g` reached Live.
The public health and signing pages returned HTTP 200 and served both the
group-member read-only marker and designated-signer gate. The authenticated
Engineering AM remained ready and HZ-CT-001 remained in the sent state. No new
LINE invitation or signing action was triggered during verification; the
existing unexpired V12 link uses the new authorization rules immediately.
