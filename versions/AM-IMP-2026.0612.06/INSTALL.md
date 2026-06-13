# Install AM-IMP-2026.0612.06

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.06.md`.

## Changes To Apply

- Extraction computes and injects per-confidence confirm rates.
- Borderline suppressed items (max 2/conversation) recorded as Case Status=New.
- Added scripts/eval-extraction.js (accuracy/precision/recall/per-confidence, --save).

## Environment Variables (names only)

- `SEVEN_JUDGMENT_CALIBRATION_CASES_DATA_SOURCE_ID`
- `ANTHROPIC_API_KEY`

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
