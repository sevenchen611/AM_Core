# Verify

- Run `node --check modules/construction/contracts.js`.
- Run `node --check modules/construction/contract-completion.js`.
- Run `node tools/dryrun-engineering-party-a-profiles.mjs`.
- Run `node tools/dryrun-engineering-contract-completion.mjs`.
- Run `node tools/dryrun-engineering-contract-workflow-api.mjs`.
- Run `node tools/dryrun-engineering-contract-pdf-renderer.mjs`.
- Run `node tools/dryrun-engineering-contract-store.mjs`.
- Run `node tools/check-upgrade-package.js AM-IMP-2026.0902.12`.
- Confirm an individual profile saves with no signing asset and the UI says the
  signature is captured per contract.
- Confirm an individual Party A sees the large contract-specific signing canvas
  only after Party B has signed.
- Confirm confirmation fails closed without the Party A consent and signature.
- Confirm the final PDF contains both Party A and Party B signatures and the
  receipt contains their distinct SHA-256 evidence.
- Confirm company Party A completion still uses the frozen large company seal.
