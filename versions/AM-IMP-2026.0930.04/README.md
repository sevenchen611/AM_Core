# Consolidated review-card actions

UOF attachment names and download buttons were split across horizontal cards.
Review cards now support up to 12 bounded actions, with optional `displayText`
(1–300 characters) rendered as a wrapped, fully clickable row. Existing action
labels remain limited to 20 characters and existing cards render unchanged.

Consumers can place filenames, links and workflow controls on one case card.
Overflow must be paginated by the caller. Authorization, URI checks, idempotency,
28 KB bubble and 45 KB message limits remain enforced. No tenant data is included.
