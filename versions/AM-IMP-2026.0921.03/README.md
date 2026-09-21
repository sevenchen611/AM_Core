# AM-IMP-2026.0921.03 — Contract workspace signing-state parity

Make the Engineering contract workspace consume the same authoritative PostgreSQL control projection as the contract control center before rendering signing actions.

This prevents a completed Party A and Party B signature pair from being hidden behind a stale Notion/overview `sent` state. Existing immutable signing evidence remains unchanged; no signer is rebound and no contract is automatically confirmed or archived.
