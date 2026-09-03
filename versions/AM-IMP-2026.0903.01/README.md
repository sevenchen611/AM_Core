# AM-IMP-2026.0903.01 Engineering Contract Control Recovery

This package makes the shared contract-store capability gate understand the
already-installed Engineering schema v9 by checking the required tables, not
by treating an exact schema version as the only acceptable state.

It is a runtime recovery only. It does not alter contracts, sessions,
signatures, LINE messages, Notion pages, or archive evidence.

## Outcome

- Schema v9 is accepted when all authority tables are present.
- Missing capability remains fail-closed.
- Future schemas remain accepted only when they supply the required table set.
- The recovery dry run documents the production read-only verification order.
