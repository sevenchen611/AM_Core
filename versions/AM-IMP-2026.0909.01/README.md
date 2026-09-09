# AM-IMP-2026.0909.01 — Finance-group verified LINE mention

This package makes Rental bank-transfer notifications truly mention the
reviewer in the single HOZO finance LINE group. It upgrades the existing
machine-only `/control/hozo/rental/finance-group/push` route; it does not create
a second LINE sender or accept raw LINE targets from Rental.

## Contract

- Rental supplies human-readable `text` and `mentionName`, a stable
  `sourceNotificationId` in the form `bank-draft-notification:v1:<UUID>`, and
  the required source-and-content-bound `retryKey`; the route never creates a
  random identifier or key for finance notifications.
- Distinct notification events use distinct source ids even when text is equal.
  An identical replay reuses the same source id, while changed content under an
  existing source id returns HTTP 409 before LINE is called.
- The route selects exactly one HOZO finance group binding across all pages by
  exact normalized canonical title/`群組名稱`, never by unrelated page text.
- The LINE user identity is read only from that selected binding page's
  `成員對照` JSON.
- The LINE group identity is read only from that page's canonical
  `LINE 群組 ID` property, which must be one rich-text value in exact
  `C` plus 32 hexadecimal format.
- The requested name must resolve to exactly one valid LINE user identity and
  must occur in the outgoing text.
- The route calls the existing `platform.pushLineMessage(groupId, text,
  { name, userId }, delivery)` path, which emits a LINE `textV2` mention.
- Missing, malformed, invalid, unknown, or ambiguous identity data stops before
  the provider call and returns a non-2xx response with `ok: false`.
- The member map parser accepts only a flat JSON string-to-string object and
  rejects duplicate decoded keys before ordinary JSON last-key-wins behavior.
- LINE member ids are exactly `U` followed by 32 hexadecimal characters.
- A LINE `409` is accepted only with provider accepted-request evidence, and the
  content-bound caller key plus route-bound provider key prevent a different
  payload or resolved destination from borrowing it.
- Neither responses nor application logs expose the resolved LINE user id.

No production group id, member id, token, Notion id, message, or customer data
is stored in this package.
