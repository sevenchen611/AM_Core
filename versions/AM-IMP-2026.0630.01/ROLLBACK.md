# Rollback AM-IMP-2026.0630.01

This package was backfilled, so rollback is described generically.

- Revert the commit(s) that applied this version in the target project.
- Restore the previous values of any environment variables introduced by this version.
- If a database column or table was added, keep it (additive) or drop it only after
  confirming no other version depends on it.
- Mark the version as rolled back in the target project's improvement manifest.

## Source Status Note

Phase 1 (foundation + live Google connection) and Phase 2 (行事曆事件 data source,
candidate detection, confirmation/chase scheduler, worker wiring): **Installed &
verified** in SevenAM. Not yet running on Render in production — the resident worker
picks up the new 15-min/hourly jobs on next deploy; the controller can also run
`npm run calendar:scan` / `calendar:sync` manually. The full project-deadline
population (≈30 events) is intentionally left for the controller to green-light.
Secrets live only in SevenAM `.env` (gitignored); nothing shared with AMCore/HOZO.
