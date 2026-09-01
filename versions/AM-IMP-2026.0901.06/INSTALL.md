# Install

1. Apply the queue progression and group-recipient changes in `modules/claims/v3/group-entry.js`.
2. Allow `claim_web_entry` only for `group_binding` recipients in `modules/claims/v3/receiver.js`.
3. Keep the existing PostgreSQL queue, idempotency, provider ledger and reconciliation tables unchanged.
4. Run the syntax, direct-flow and package checks.
5. Merge through a pull request and let Render deploy GitHub `main`.

No environment or database migration is required.
