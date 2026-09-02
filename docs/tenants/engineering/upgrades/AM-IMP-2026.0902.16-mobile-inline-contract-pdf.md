# AM-IMP-2026.0902.16 - Mobile inline contract PDF signing

Status: Deployed

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
package, and whitespace checks passed locally.

Production verification completed on 2026-09-02:

- PR #115 merged as `ecf31b5aa48c40ead573a02eafbe79d781f7b073`.
- The production signing page returned HTTP 200 with the inline reader and
  external-browser controls and no `about:blank` flow.
- The production PDF.js module and worker returned HTTP 200 from the same
  origin (424,135 and 1,078,612 bytes) with immutable cache and same-origin
  resource-policy headers.
- The production health endpoint returned HTTP 200.
- No LINE message, signing submission, signer assignment, or contract state
  change was performed during verification. A real Android LINE signing pass
  remains the final device-level confirmation.
