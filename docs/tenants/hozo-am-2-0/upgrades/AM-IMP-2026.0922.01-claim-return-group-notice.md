# AM-IMP-2026.0922.01 — Claim return group notice

Legacy external claims can now route financial status events through the exact
opaque LINE group reference already registered by Claims Authority. Rejected and
supplement-requested events accept a bounded reviewer reason and render it in the
source-group message.

The change does not expose raw LINE group identifiers, add a fallback group, or
send to an ambiguous reference. Unknown and duplicated references fail closed.

Production activation requires the compatible Rental sender release. Existing
failed outbox rows remain durable and can be retried after both services are live.
