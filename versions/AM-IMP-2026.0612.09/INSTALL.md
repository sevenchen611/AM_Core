# Install AM-IMP-2026.0612.09

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.09.md`.

## Changes To Apply

- Extraction and report pages load official projects excluding 候選/封存.
- Added scripts/propose-projects.js with conservative LLM proposal (max 3) and LINE notification.
- Review page section 六 with approve (規劃中+啟用) / reject (封存).
- render.yaml seven-jr-project-proposals cron (22:20 Taipei).

## Environment Variables (names only)

- `SEVEN_PROJECTS_DATA_SOURCE_ID`

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
