# AM-IMP-2026.0922.01 — Claim return group notice

Allow the legacy Rental claim-event receiver to resolve a verified
`line-ref:v1` group reference and include the reviewer-provided return reason in
the LINE group message.

The recipient registry remains exact and fail-closed. Raw LINE group IDs are
used only inside the AM runtime delivery boundary and are never returned to the
Rental sender or written into the claim event.
