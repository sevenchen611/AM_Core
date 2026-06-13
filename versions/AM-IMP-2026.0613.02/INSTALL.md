# Install AM-IMP-2026.0613.02

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-13-AM-IMP-2026.0613.02.md`.

## Changes To Apply

- `scripts/start-local-worker.ps1` (both projects): `& cmd /c "node scripts/local-worker.js >> \"$logFile\" 2>&1"` replaces the Tee-Object pipeline; warning comment documents the pitfall.

## Environment Variables (names only)

None.

## Data Isolation Check

Launcher script only.
