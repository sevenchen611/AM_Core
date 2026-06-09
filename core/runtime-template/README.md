# AM Core Runtime Template

This folder preserves the current aligned runtime starting point for future AM_Core extraction.

It is not yet a fully generic runtime.

## Current Source

The main runtime files are copied from the currently aligned HOZO_AM local code because HOZO_AM now includes:

- Data isolation guard
- Multi-recipient report support
- LINE task-query reply
- Event-conclusion daily report
- Five-slot goal recognition
- Hierarchical responsibility owner narrowing
- Immediate LINE command mode

SevenAM-only maintenance scripts that still need generic conversion are kept under:

```text
scripts/seven-reference/
```

## Before This Becomes Shared Runtime

The next extraction pass must replace project-specific names with adapter/env loading:

- `HOZO_*` and `SEVEN_*` env names
- hard-coded project display names
- project-specific Notion parent checks
- project-specific report category rules
- project-specific Render service naming

## Do Not Add

- `.env`
- tokens
- production database IDs as required defaults
- Render secret values
- customer records

