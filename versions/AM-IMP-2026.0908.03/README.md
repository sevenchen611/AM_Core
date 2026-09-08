# AM-IMP-2026.0908.03 — Contract IP evidence and explicit event timeline

Completes the Engineering contract IP evidence chain and replaces ambiguous
control-center event names with full audit explanations.

The PostgreSQL evidence schema already stores a full `inet` value on every
signing event. Existing Party A and Party B open/sign submissions therefore do
not need a schema migration. The authorized single-contract detail now exposes
the dispatch, first-open and signature-submission IPs for each party while the
bulk summary deliberately omits them.

New issuance flows also carry the server-resolved trusted client IP through the
durable outbox into both the `issued` and `sent` events. Raw forwarding headers
are never persisted and browser-supplied IP fields are removed before domain
handling. New evidence receipts use the v4 dual-party IP structure.

Historical evidence receipts remain immutable. A completed older contract uses
its append-only PostgreSQL event chain for the new detail display; absent legacy
values are labelled as not recorded and are never guessed or backfilled.

