# Install AM-IMP-2026.0612.15

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.15.md`.

## Changes To Apply

- render.yaml: the three 15-minute crons restricted to UTC `0-14,23` (Taipei 07:00-22:45 last run).
- scripts/local-worker.js: active-hours gate (`SEVEN_WORKER_ACTIVE_HOUR_START`/`SEVEN_WORKER_ACTIVE_HOUR_END`, default 7/23, Taipei). Outside the window the worker pauses scanning AND heartbeats (5-minute time checks); on resuming it sends an immediate heartbeat so Render crons stand down without racing.
- AGENTS.md: System operating hours section under Scheduled Reports.

## Environment Variables (names only)

- `SEVEN_WORKER_ACTIVE_HOUR_START`
- `SEVEN_WORKER_ACTIVE_HOUR_END`

## Data Isolation Check

Schedule-only change; no data sources touched.
