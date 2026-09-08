# AM-IMP-2026.0908.02 — Final contract access and control-detail parity

Repairs two read-path defects after an Engineering contract reaches completed
electronic signing.

The control-center detail view now loads the same enriched PostgreSQL contract
projection as the summary list. It therefore retains the authoritative signing
session id, loads both parties' signing evidence, and displays the actual event
timeline and archive state instead of falling back to an unsigned state.

The contract workspace promotes the immutable final signed PDF and evidence
receipt after completion. Both files are streamed through an authenticated,
tenant-scoped server route that rechecks private Drive visibility and verifies
the stored SHA-256 before returning any bytes. The pre-signing merged preview is
retained and relabelled as the frozen pre-signing version for audit purposes.

This package has no schema migration and does not modify existing contract,
version, signature, event, artifact, LINE, Notion, or Drive records.
