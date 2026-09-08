# Verify

Run:

```text
node --check modules/construction/contract-control-center.js
node --check modules/construction/contract-final-artifact-reader.js
node --check modules/construction/contract-workflow-api.js
node --check modules/construction/contracts.js
node tools/dryrun-engineering-contract-control-center.mjs
node tools/dryrun-engineering-contract-final-artifacts.mjs
node tools/dryrun-engineering-contract-workspace.mjs
node tools/dryrun-engineering-contract-control-routes.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0908.02
node tools/audit-alignment.js
```

Production read-only checks:

1. Confirm the deployed commit is live and `/health` returns HTTP 200.
2. Open HZ-CT-001 in the contract workspace.
3. Confirm `開啟最終簽署合約 PDF` is the primary document action and returns
   an authenticated PDF response with a verified SHA-256 header.
4. Confirm the evidence-receipt action returns the private JSON receipt.
5. Confirm the old merged preview is labelled `簽署前凍結版本與附件`.
6. Open HZ-CT-001 from the control center and confirm archived status, both
   parties signed, no current holder, `流程已歸檔`, and a populated timeline.
7. Do not issue, sign, confirm, archive, resend, edit, or create a contract while
   performing these checks.
