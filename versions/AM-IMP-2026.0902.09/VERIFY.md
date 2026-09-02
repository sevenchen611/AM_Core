# Verify

- Run `node --check modules/construction/contract-signing-web.js`.
- Run `node tools/dryrun-engineering-contract-signing-web.mjs`.
- Run `node tools/dryrun-engineering-contract-signing.mjs`.
- Run `node tools/dryrun-engineering-contract-runtime.mjs`.
- Run `node tools/dryrun-engineering-contract-security-gates.mjs`.
- Confirm the public signing page says that the PDF is read-only and must not
  be signed with a PDF-viewer drawing tool.
- Confirm the signer receives a signature canvas at least 320 pixels high on a
  phone-sized viewport.
- Confirm touch strokes can be cleared and resubmitted through the existing
  protected signature endpoint.
- Confirm read-only LINE group members still cannot see signing controls.
