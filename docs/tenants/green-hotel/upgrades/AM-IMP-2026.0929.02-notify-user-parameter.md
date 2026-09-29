# Per-request LINE group notification recipient

Status: Installed. Production activation pending verification.

The caller can choose `notifyUserId` for each authorized group report. Omission preserves the existing default; null disables @. A new send requires successful group membership verification within five seconds. Invalid IDs and nonmembers cannot cause a push. Recipient changes under the same idempotency key conflict; equivalent default requests preserve existing receipts.

Local verification: twelve API/provider tests, bank intake webhook regression and LINE delivery timeout/retry checks pass. No schema, credential or destination-group permission change is required. Input filtering remains separate from output recipient selection. Caller-specific IDs, keys and live receipts stay outside AMCore source.
