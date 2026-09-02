# AM-IMP-2026.0902.12 - Contract-specific Party A dual signing

Status: Installed

## Engineering installation

- Individual Party A profiles retain identity and address data but no reusable
  signature asset.
- After the designated Party B signer completes the existing LINE signing flow,
  the internal confirmation page requires a fresh Party A signature and explicit
  consent for that contract.
- The Party A signature is stored as a private, immutable artifact bound to one
  frozen contract version and signing session.
- Company Party A profiles continue to use the large company seal frozen into
  the selected profile snapshot.
- Final PDFs and evidence receipts identify Party A and Party B signing evidence
  with distinct SHA-256 hashes.

## Verification boundary

Local schema-v7 migration, individual-profile validation, contract completion,
artifact privacy, PDF rendering, workflow API, PostgreSQL store, syntax,
whitespace and package checks passed. Production database migration, Render
deployment, graphical contract-page verification and a real end-to-end dual
signature remain pending. No LINE invitation or contract signature was created
during local verification.
