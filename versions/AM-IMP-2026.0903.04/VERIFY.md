# Verify

- node --check modules/construction/contract-payments.js
- node --check modules/construction/contract-payment-api.js
- node tools/dryrun-engineering-contract-payments.mjs
- node tools/check-upgrade-package.js AM-IMP-2026.0903.04

Before production enablement, the Engineering owner must verify:

1. A draft or only-signed contract cannot create a payment claim.
2. A claim cannot exceed the immutable milestone amount.
3. Claim evidence includes protected references and SHA-256 hashes.
4. A submitter cannot review their own claim; a reviewer cannot approve it.
5. Repeating the same idempotency key returns the prior result without a new
   event.
6. The database rejects payment-event updates and deletes.
7. Approval creates no bank transfer, payment instruction, or paid status.

Run the production checks only with an authorized, read-safe test claim. Do not
use the demolition contract or any customer payment as a test fixture.
