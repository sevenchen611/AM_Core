# Verify

- Run `npm run check`, `npm run dryrun`, `npm run dryrun:claims-authority`,
  `npm run verify:bank-mention`, `npm run dryrun:processing-jobs`.
- Run `node --experimental-vm-modules tools/verify-bank-line-reply-intake.mjs`.
- Run `node tools/check-upgrade-package.js AM-IMP-2026.0928.01`.
- Verify deployed main SHA and service health. Inspect the authorized HOZO
  `/memory?tenant=hozo-am-2-0` console for receipt state.
- On the next genuine reply, check source text/quote/time are saved, intake does
  not wait for Rental, and Rental records the same event once. Observe retry or
  manual-review state on failures. Do not post a synthetic reply to production
  or infer a historical envelope from fingerprints.

The receipt message uses the original reply token only after saving. Token
delivery failure does not remove the saved reply. Accounting result messages
remain in Rental's durable response outbox.
