# Install AM-IMP-2026.0613.04

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-13-AM-IMP-2026.0613.04.md`.

## Changes To Apply

- SevenAM render.yaml: `sevenam-queue-db` plan free → `basic-256mb` (~$6/月), permanently removing the 7/11 free-tier expiry deadline.
- HOZO render.yaml: `hozoam-queue-db` plan free takes the released slot for the test period (upgrade one line when productionizing).
- Documented Render constraints discovered live: one free Postgres per account; Blueprint sync creates/updates but never deletes — removed resources must be deleted manually in the dashboard.

## Environment Variables (names only)

- `DATABASE_URL`

## Data Isolation Check

Each project has its own database; no shared connection strings.
