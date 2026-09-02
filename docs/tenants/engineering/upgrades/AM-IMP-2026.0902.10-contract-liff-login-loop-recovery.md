# AM-IMP-2026.0902.10 - Contract LIFF login-loop recovery

Status: Deployed

## Engineering installation

- The signing page preserves LINE OAuth callback parameters until LIFF has
  restored the authenticated session.
- The fragment-only signing token is still removed from the visible URL and is
  never copied into a query string.
- A fresh invitation permits one automatic LINE Login redirect. A failed
  callback stops with explicit recovery guidance instead of redirecting again.
- Current non-signing group members continue into read-only contract access;
  the designated signer alone receives signing controls.

## Verification boundary

The signing-page, signing-service, runtime, security-gate, package, syntax, and
whitespace checks passed. PR #103 merged at commit `7771d23`; Render deployment
`dep-dabvq5fqj5pc73dld740` reached Live. Production health and signing pages
returned HTTP 200 and served the callback-preservation, one-attempt guard, and
stopped-retry markers. A fresh designated-signer/non-signer phone check from the
original LINE group message remains the final device confirmation. No
invitation, signature, contract state, or LINE message was changed during
deployment verification.
