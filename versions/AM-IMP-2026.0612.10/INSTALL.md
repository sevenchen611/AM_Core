# Install AM-IMP-2026.0612.10

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.10.md`.

## Changes To Apply

- Added scripts/parse-attachments.js (15-min cron, mammoth/xlsx/jszip for Office).
- server.js now creates attachment records for images with privacy gate; 轉檔狀態 select vocabulary registered programmatically.
- Auto-created attachment properties: 解析摘要, 解析時間.

## Environment Variables (names only)

- `SEVEN_ATTACHMENTS_DATA_SOURCE_ID`
- `ANTHROPIC_API_KEY`

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
