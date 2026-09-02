# Verify

- Run `node --check modules/construction/contract-signing-web.js`.
- Run `node tools/dryrun-engineering-contract-signing-web.mjs`.
- Run `node tools/dryrun-engineering-contract-signing.mjs`.
- Run `node tools/dryrun-engineering-contract-runtime.mjs`.
- Run `node tools/dryrun-engineering-contract-security-gates.mjs`.
- Run `node tools/check-upgrade-package.js AM-IMP-2026.0902.10`.
- Confirm the generated page preserves `location.search` while removing the
  token fragment before `liff.init()`.
- Confirm OAuth callback cleanup occurs only after `liff.init()`.
- Confirm only one `liff.login()` call can occur per fresh signing-link open.
- Confirm a second unauthenticated callback shows the stopped-retry message and
  does not call LINE Login again.
- Confirm a verified non-signing member can open the protected PDF in read-only
  mode and cannot see or submit signing controls.
- Confirm no raw signing token appears in a query string, response body, or log.
