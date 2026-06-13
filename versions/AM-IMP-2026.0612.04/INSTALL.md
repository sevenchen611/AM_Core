# Install AM-IMP-2026.0612.04

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.04.md`.

## Changes To Apply

- Added scripts/run-cron-with-alert.js; applied to judgement/meeting/responsibility/triage/attachment/proposal crons in render.yaml.

## Environment Variables (names only)

- `CONTROL_LINE_PUSH_URL`
- `SEVEN_CONTROL_API_KEY`
- `AM_CRON_ALERTS_ENABLED`

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
