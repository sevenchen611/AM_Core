# Install AM-IMP-2026.0612.08

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.08.md`.

## Changes To Apply

- Added src/report-pages.js; control-api serves dynamic pages with static-prototype fallback.
- Approve API: followupSends, snoozes, taskNotes, projectAssigns, attachmentDecisions, projectProposalDecisions.
- Dismissals no longer set 確認狀態=已確認 (calibration corruption fix); chase sends auto-snooze 2 days; notes carry report-source labels and feed 最新備註 for AI context.
- Auto-created task properties: 追蹤暫緩至, 最新備註.

## Environment Variables (names only)

- `SEVEN_PROJECTS_DATA_SOURCE_ID`

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
