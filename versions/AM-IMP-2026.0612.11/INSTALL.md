# Install AM-IMP-2026.0612.11

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.11.md`.

## Changes To Apply

- Added src/llm-backend.js (completeJson contract, env cleaning for nested CLI calls, JSON repair).
- Added scripts/local-worker.js (auth self-test exit 2, 3-failure heartbeat suspension) and start-local-worker.ps1 (crash restart).
- event-queue worker_heartbeats table; server.js /worker/heartbeat (control-key) and /worker/status.
- run-cron-with-alert.js AM_SKIP_IF_WORKER_ACTIVE gate on judgement and triage crons.

## Environment Variables (names only)

- `LLM_BACKEND`
- `SEVEN_WORKER_HEARTBEAT_URL`
- `SEVEN_WORKER_INTERVAL_SECONDS`
- `SEVEN_WORKER_HEARTBEAT_MAX_AGE_SECONDS`
- `CLAUDE_CODE_MODEL`

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
