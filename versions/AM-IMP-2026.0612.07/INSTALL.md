# Install AM-IMP-2026.0612.07

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.07.md`.

## Changes To Apply

- scripts/llm-task-extraction.js system prompt and user message restructured; parseTaipeiDisplayTime ported; maybeLinkParentTask added; --print-system-prompt debug flag.

## Environment Variables (names only)

None.

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
