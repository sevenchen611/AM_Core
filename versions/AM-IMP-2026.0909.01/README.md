# AM-IMP-2026.0909.01 — Finance-group verified LINE mention

This package makes Rental bank-transfer notifications truly mention the
reviewer in the single HOZO finance LINE group. It upgrades the existing
machine-only `/control/hozo/rental/finance-group/push` route; it does not create
a second LINE sender or accept raw LINE targets from Rental.

## Contract

- Rental supplies human-readable `text` and `mentionName` only.
- The route selects exactly one HOZO finance group binding.
- The LINE user identity is read only from that selected binding page's
  `成員對照` JSON.
- The requested name must resolve to exactly one valid LINE user identity and
  must occur in the outgoing text.
- The route calls the existing `platform.pushLineMessage(groupId, text,
  { name, userId }, delivery)` path, which emits a LINE `textV2` mention.
- Missing, malformed, invalid, unknown, or ambiguous identity data stops before
  the provider call and returns a non-2xx response with `ok: false`.
- Neither responses nor application logs expose the resolved LINE user id.

No production group id, member id, token, Notion id, message, or customer data
is stored in this package.
