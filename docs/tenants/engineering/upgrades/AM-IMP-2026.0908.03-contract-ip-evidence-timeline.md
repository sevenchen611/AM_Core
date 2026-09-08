# Contract IP evidence and explicit event timeline — 2026-09-08

Status: Deployed

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

- Main release: PR `#132`, commit
  `92037b9016b23d1a6e6be9d65d7e45dd0281fd70`, Render deploy
  `dep-dafsff6q1p3s73eas510`.
- Explicit issued-PDF description: PR `#133`, commit
  `92afd989c8081242448c9667a25c901e3050d633`, Render deploy
  `dep-dafsgo142hec73dk938g` (`Live` on 2026-09-08).
- Production `/health` returned HTTP 200 with JSON.
- The authenticated HZ-CT-001 detail displays Party A and Party B first-open
  and signing-submit IP values directly from the immutable PostgreSQL events.
  The historical issuance and send events contain no IP and are explicitly
  shown as `未記錄`; no replacement value was invented.
- The production timeline names the formal V14 issuance, LINE invitation,
  Party A and Party B identity/open/sign/receive actions, internal confirmation,
  final archive, and each stored artifact with a complete explanation.
- `issued_pdf`, Party A signature image, final signed PDF, and evidence-receipt
  JSON each state exactly what was preserved and how integrity is verified.
- Forty Engineering dry-run suites, syntax checks, package validation, and
  whitespace checks passed. The alignment audit was executed and retained only
  the repository's pre-existing external-project-path and historical-manifest
  findings.
- Verification was read-only: no contract, version, signing session, signature,
  event, artifact, LINE message, Notion row, Drive file, schema, or Render
  environment value was changed.
