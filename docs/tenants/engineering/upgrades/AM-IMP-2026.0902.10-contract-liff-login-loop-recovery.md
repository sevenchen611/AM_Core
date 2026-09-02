# AM-IMP-2026.0902.10 - Contract LIFF login-loop recovery

Status: Installed

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

Local verification is pending. Production deployment and a controlled
designated-signer/non-signer mobile check remain required. No invitation,
signature, contract state, or LINE message was changed during implementation.
