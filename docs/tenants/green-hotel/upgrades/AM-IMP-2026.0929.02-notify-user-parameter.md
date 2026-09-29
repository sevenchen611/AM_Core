# Per-request LINE group notification recipient

Status: Deployed. Verified 2026-09-29.

The caller can choose `notifyUserId` for each authorized group report. Omission preserves the existing default; null disables @. A new send requires successful group membership verification within five seconds. Invalid IDs and nonmembers cannot cause a push. Recipient changes under the same idempotency key conflict; equivalent default requests preserve existing receipts.

Local verification: twelve API/provider tests, bank intake webhook regression and LINE delivery timeout/retry checks pass. No schema, credential or destination-group permission change is required. Input filtering remains separate from output recipient selection. Caller-specific IDs, keys and live receipts stay outside AMCore source.

## Production verification

PR #205 passed GitHub validation and was merged into main. Production /health reports commit `db0dfaa94a34741783b0929d522e25c9166fd9f7`, LINE I/O enabled, and version 1.1.0.

An explicitly supplied recipient push to the owner's authorized group returned accepted with the requested recipient and two LINE message IDs. Repeating the body/key returned the same accepted request and message IDs with replayed=true. Changing the recipient to null under that key returned 409 idempotency_conflict. A malformed recipient returned 400 invalid_notify_user; a verified-absent member returned 403 notify_user_unavailable without push. A pre-upgrade receipt requested with the legacy omitted field returned its original accepted IDs and replayed=true.

Provider acceptance is not proof of reading or business approval. Caller handoff, OpenAPI and Python client were updated outside AMCore; actual identifiers and receipts remain in caller/private files. No new environment or database configuration was needed.
