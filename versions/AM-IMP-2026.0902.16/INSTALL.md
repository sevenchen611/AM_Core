# Install

1. Install the exact `pdfjs-dist` dependency recorded in `package-lock.json`.
2. Deploy `modules/construction/contract-signing-web.js` together with
   `package.json` and `package-lock.json`.
3. Confirm the public contract router serves both same-origin PDF.js module
   paths declared in `upgrade.json`.
4. No database migration or environment-variable change is required.

Do not copy a signing token, PDF, signature, or production contract record into
AMCore or a test fixture.

