# Install AM-IMP-2026.0612.05

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.05.md`.

## Changes To Apply

- Added scripts/sync-extraction-feedback.js (verdict capture, idempotent by Source Task relation, rule suggestions, per-confidence stats).
- Extraction loads Status=Active rules each run.
- render.yaml seven-jr-extraction-feedback-sync cron (22:45 Taipei).

## Environment Variables (names only)

- `SEVEN_JUDGMENT_CALIBRATION_CASES_DATA_SOURCE_ID`
- `SEVEN_JUDGMENT_RULES_DATA_SOURCE_ID`
- `ANTHROPIC_API_KEY`

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
