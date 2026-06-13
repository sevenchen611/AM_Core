# Install AM-IMP-2026.0613.03

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-13-AM-IMP-2026.0613.03.md`.

## Changes To Apply

- `scripts/local-worker.js` (both projects): 15-min/hourly interval tracking, REPORT_TIMETABLE with grace window (reports POST through `scripts/render-cron-report.js` to the webhook's `/control/reports/send`), nightly run-once-per-day markers.
- SevenAM render.yaml: 13 crons → 3 (extraction + triage API fallbacks with worker-heartbeat stand-down, and attachment parsing which requires the Anthropic API for vision). HOZO render.yaml: zero crons (Codex-only, no fallback by design).
- `.env`: CONTROL_API_URL added for the worker-driven report sends.
- Frees ~10 Render resource slots per the 25-per-workspace cap and their starter-plan cron costs.

## Environment Variables (names only)

- `CONTROL_API_URL`

## Data Isolation Check

Each project's worker talks only to its own webhook and Notion sources.
