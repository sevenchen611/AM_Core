# Verify

Run from the AM Core checkout:

```text
node --check modules/claims/index.js
node tools/dryrun-claims.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0811.05
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

Production verification:

1. Confirm `/health` reports `claims` as requested and loaded for
   `hozo-am-2-0` from the deployed commit.
2. Confirm the Rental emitter is deployed only after this receiver.
3. Do not create or approve a fake bank review for deployment testing.
4. On the next genuine approved review, confirm the original claim group gets
   one message with the title, reviewed amount, and expected disbursement.
5. Confirm the message says review approval does not prove release or credit.
