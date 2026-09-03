# AM-IMP-2026.0903.04 Contract Payment Operations

This package adds an Engineering-only payment execution layer on top of an
already signed and internally confirmed contract version. It does not alter
payment milestones, does not call a bank, and does not turn a claim approval
into a funds-release action.

The module creates a controlled sequence:

1. Read the frozen contract version and its evidence hash.
2. Derive the eligible payment schedule from the immutable milestone.
3. Submit a claim with source summary and hash-verified evidence references.
4. Have a different authorized user review it.
5. Have a third authorized user approve it.
6. Hand off any actual finance processing to the existing finance process.

Every change creates an append-only audit event with an idempotency key. The
safe presentation deliberately omits evidence hashes, protected references,
bank information, and raw actor identifiers.

## Status

Ready for local domain verification. It is not deployed and it contains no
production payment, claim, bank, or customer data.
