# Install AM-IMP-2026.0612.02

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.02.md`.

## Changes To Apply

- Added scripts/llm-task-extraction.js: conversation timeline judging, JSON schema output, task creation with 待確認, evidence updates, conversation judged marking.
- render.yaml judgement-sync cron switched to the LLM script.

## Environment Variables (names only)

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
