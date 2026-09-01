# AM-IMP-2026.0901.05 — Finance Claim entry delivery TTL alignment

This package aligns the final Finance Claims v3 LINE delivery validator with the ten-minute source-hint lifetime already accepted by the bridge and durable group-entry consumer.

Previously, a valid ten-minute entry could be created successfully and then be rejected as `invalid_payload` immediately before the private LINE push because the delivery validator still enforced the historical five-minute ceiling. The validator now uses the shared ten-minute `MAX_SOURCE_HINT_AGE_SECONDS` constant. All origin, path, query, signature, expiry-format, recipient, idempotency, and notification-ledger checks remain unchanged.
