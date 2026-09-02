# AM-IMP-2026.0902.09 - Mobile large signature pad

Status: Deployed

## Engineering installation

- The contract PDF is explicitly identified as a read-only review document.
- Signers are told to return to Engineering AM instead of drawing inside their
  phone's PDF viewer.
- The designated-signer panel uses a large, green-bordered signature canvas
  sized for finger input on mobile devices.
- The existing protected submission flow remains responsible for saving the
  signature and inserting it into the completed contract and promissory note.
- Current LINE-group read-only viewers remain unable to see or submit signing
  controls.

## Verification boundary

Signing-page, signing-service, runtime, security-gate, package, syntax, and
whitespace verification passed. PR #101 was merged at commit `432b055` and
Render deployment `dep-dabvjj3bc2fs73eulre0` reached Live. Public health and
signing pages returned HTTP 200 and served the PDF warning, large-canvas CSS,
and small-PDF-frame guidance. No invitation was opened and no signature or LINE
message was submitted during verification.
