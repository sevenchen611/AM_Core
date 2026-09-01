# AM-IMP-2026.0901.02 — Production Finance Claim Entry Message

This patch moves the HOZO Finance Claims v3 private entry notification from the canary template to the production template.

It keeps the existing private-only entry delivery, opaque LINE identity references, durable idempotency, retry, reconciliation, and provider-delivery ledger. It does not change the rule that the finance group receives a message only after a claim is successfully submitted.
