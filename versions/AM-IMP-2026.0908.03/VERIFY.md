# Verify

Run:

```text
node --check modules/construction/contract-signing.js
node --check modules/construction/contract-runtime.js
node --check modules/construction/contract-issuance.js
node --check modules/construction/contract-outbox.js
node --check modules/construction/contract-completion.js
node --check modules/construction/contract-control-center.js
node --check modules/construction/contract-control-center-web.js
node --check modules/construction/contract-workflow-api.js
node tools/dryrun-engineering-contract-signing.mjs
node tools/dryrun-engineering-contract-runtime.mjs
node tools/dryrun-engineering-contract-issuance.mjs
node tools/dryrun-engineering-contract-outbox.mjs
node tools/dryrun-engineering-contract-completion.mjs
node tools/dryrun-engineering-contract-control-center.mjs
node tools/dryrun-engineering-contract-control-web.mjs
node tools/dryrun-engineering-contract-workflow-api.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0908.03
node tools/audit-alignment.js
```

Production read-only checks:

1. Confirm the deployed commit is Live and `/health` returns HTTP 200.
2. Open HZ-CT-001 from the authenticated control center.
3. Confirm Party A and Party B each show `送簽來源 IP`,
   `首次開啟（收件）IP`, and `簽署提交 IP`.
4. Confirm existing IPs are full PostgreSQL values; a missing legacy value must
   say `未記錄` rather than display a fabricated value.
5. Confirm the event title identifies the exact action and every event has a
   complete explanatory paragraph.
6. Confirm final PDF, evidence-receipt JSON, and Party A signature-image entries
   state exactly which file was preserved and why.
7. Do not issue, resend, open a signer link, sign, confirm, archive, or modify a
   contract while performing production verification.

