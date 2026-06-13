# Install AM-IMP-2026.0612.01

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.01.md`.

## Changes To Apply

- Added src/event-queue.js (line_event_queue table, FOR UPDATE SKIP LOCKED claims, retry backoff 30s-2h, dead-letter status).
- Webhook enqueues then replies 200; background worker writes to Notion; reply failures are non-fatal.
- Dead-letter events push a LINE alert to SEVEN_ALERT_TARGET_ID.
- GET /health reports eventQueue stats.
- render.yaml defines sevenam-queue-db Postgres; pg dependency added.

## Environment Variables (names only)

- `DATABASE_URL`
- `SEVEN_ALERT_TARGET_ID`
- `DATABASE_SSL`

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
