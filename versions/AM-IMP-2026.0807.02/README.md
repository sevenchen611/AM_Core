# AM-IMP-2026.0807.02 — Personal Calendar LINE operations

Adds tenant-safe personal Calendar operations to the HOZO AM 2.0 one-to-one
LINE assistant. The package keeps Rental Calendar as the source of truth and
uses the existing `person_id ↔ LINE userId` identity link for every request.

Capabilities:

- `我的今天`, `我的行程`, `昨天未完`, and `這週` queries.
- Confirm-before-write personal task creation.
- Short-lived item numbers for complete, move, cancel, and reminder commands.
- Source-backed AM task projection when owner, date, and source evidence are explicit.
- Read-only protection for AM-originated items.
