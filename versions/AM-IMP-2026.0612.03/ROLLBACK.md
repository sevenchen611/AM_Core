# Rollback AM-IMP-2026.0612.03

This package was backfilled, so rollback is described generically.

- Revert the commit(s) that applied this version in the target project.
- Restore the previous values of any environment variables introduced by this version.
- If a database column or table was added, keep it (additive) or drop it only after
  confirming no other version depends on it.
- Mark the version as rolled back in the target project's improvement manifest.

## Source Status Note

Deployed to SevenAM production (2026-06-12). AM_Core portable package: pending extraction when applying to HOZO AM.
