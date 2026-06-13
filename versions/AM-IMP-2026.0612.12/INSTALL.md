# Install AM-IMP-2026.0612.12

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.12.md`.

## Changes To Apply

- server.js isControllerPersonalChat gate across buildCommandReply.
- Triage maybeReply checks command User ID against SEVEN_CONTROLLER_USER_ID.
- 4 polluted cases quarantined; 4 task summaries cleaned; incident documented in AGENTS.md.

## Environment Variables (names only)

- `SEVEN_CONTROLLER_USER_ID`

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
