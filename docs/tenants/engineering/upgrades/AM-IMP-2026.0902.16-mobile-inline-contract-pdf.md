# AM-IMP-2026.0902.16 - Mobile inline contract PDF signing

Status: Installed

## Engineering installation

- The protected frozen PDF is fetched with the existing POST authorization and
  rendered page-by-page in the signing page with same-origin PDF.js assets.
- Consent and submission remain locked until the exact PDF loads successfully.
- The reviewed marker is scoped to the signing session and document hash and is
  removed after a successful signature submission.
- LINE users can explicitly open the complete fragment-token link in an
  external browser through LIFF without losing the signing token.
- Party A, Party B, and read-only group-member authorization is unchanged.

## Verification boundary

Signing web, signing service, LIFF, runtime, security gate, issuance, syntax,
package, and whitespace checks pass locally. Production deployment and a
read-only production page/asset check remain pending. No LINE message, signing
submission, or contract state change is part of this installation record.

