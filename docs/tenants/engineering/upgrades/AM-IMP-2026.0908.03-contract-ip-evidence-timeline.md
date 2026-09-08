# Contract IP evidence and explicit event timeline — 2026-09-08

Status: Ready

## Scope

- Preserve the trusted source IP for new formal issuance and LINE-send events.
- Continue preserving Party A and Party B first-open and signing-submit IPs in
  the append-only PostgreSQL event chain.
- Display full IP evidence only inside the authorized contract detail drawer.
- Generate future evidence receipts with dispatch, Party A, Party B and internal
  confirmation IP sections.
- Replace generic `合約事件` entries with complete action and evidence
  explanations.

## Existing HZ-CT-001 evidence

The immutable v3 receipt contains the main Party B signing IP. The authoritative
PostgreSQL signing events retain the event-level IP values that were captured at
the time. This release reads those existing rows for the detail display; it does
not rewrite the receipt or fabricate missing historical issuance data.

## Safety boundary

- No schema migration or database-owner access is required.
- Raw forwarding headers are not written to the outbox or event store.
- Browser-supplied IP and request-metadata fields are stripped.
- Bulk contract summaries, LINE messages, and public completion responses do
  not expose full IP values.
- Verification is read-only and must not create a signing or contract event.

## Deployment record

Pending reviewed merge and production verification.

