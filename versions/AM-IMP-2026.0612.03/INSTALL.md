# Install AM-IMP-2026.0612.03

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.03.md`.

## Changes To Apply

- Added scripts/llm-codex-command-triage.js with --reply for instant LINE answers (controller-only).
- render.yaml seven-jr-codex-command-triage cron (*/15).

## Environment Variables (names only)

- `ANTHROPIC_API_KEY`
- `SEVEN_CODEX_COMMANDS_DATA_SOURCE_ID`
- `CONTROL_LINE_PUSH_URL`
- `SEVEN_CONTROL_API_KEY`

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
