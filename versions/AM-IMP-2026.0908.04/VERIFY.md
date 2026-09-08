# Verify

Run:

```text
node --check modules/construction/contract-signing.js
node --check modules/construction/contract-signing-web.js
node --check modules/construction/contract-runtime.js
node tools/dryrun-engineering-contract-signing.mjs
node tools/dryrun-engineering-contract-signing-web.mjs
node tools/dryrun-engineering-contract-runtime.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0908.04
node tools/audit-alignment.js
```

Production read-only checks:

1. Confirm the deployed commit is Live and `/health` returns HTTP 200.
2. Open the completed contract from its original LINE invitation.
3. Confirm LINE identity and current exact-group membership are required.
4. Confirm the page states that signing and formal archiving are complete.
5. Confirm no Party A or Party B input, identity upload, signature or submit
   control is visible.
6. Open the document and confirm the UI identifies it as the final signed PDF.
7. Confirm the PDF request remains private/no-store and returns a valid PDF.
8. Do not sign, resend, confirm, rearchive or modify a contract while verifying.
