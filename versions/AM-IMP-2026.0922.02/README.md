# AM-IMP-2026.0922.02 — Claim origin group return routing

Persist an opaque reference to the actual LINE group that opened a legacy
claim. Later Rental status events resolve that tenant-scoped reference through
Claims Authority and return to the same group, independently of the accounting
source group.

No raw LINE group ID crosses the AM/Rental boundary. Unknown, inactive, left,
or ambiguous recipients fail closed.
