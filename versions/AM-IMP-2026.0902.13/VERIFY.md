# Verify

Run:

```text
node tools/dryrun-engineering-contract-signing.mjs
node tools/dryrun-engineering-contract-signing-web.mjs
node tools/dryrun-engineering-contract-runtime.mjs
node tools/dryrun-engineering-contract-security-gates.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0902.13
```

Production checks:

1. Open the existing contract link as a verified current group member who is
   not the designated signer.
2. Confirm the page identifies itself as `簽署檢查模式（唯讀）`.
3. Confirm the counterparty fields, both identity upload positions, consent,
   large signature box, and submit control are all visible.
4. Confirm every input is disabled, the signature canvas is inert, and the
   submit control reads `檢查模式不可送出`.
5. Confirm the protected PDF remains readable.
6. Confirm a non-signer submit request still fails with `SIGNER_MISMATCH`
   before signature or identity evidence storage.
7. Confirm the contract remains in its prior state and no LINE message,
   invitation, signature event, or workflow transition is created.

