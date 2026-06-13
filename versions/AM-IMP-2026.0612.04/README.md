# AM-IMP-2026.0612.04 Cron failure alert wrapper

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.04.md`.

## Summary

All sync crons run through a wrapper that pushes a LINE alert when the wrapped script exits non-zero, with stderr tail in the message.

## Changes

- Added scripts/run-cron-with-alert.js; applied to judgement/meeting/responsibility/triage/attachment/proposal crons in render.yaml.

## Type

Reliability

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

All sync crons run through a wrapper that pushes a LINE alert when the wrapped script exits non-zero, with stderr tail in the message.
