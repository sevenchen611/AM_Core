# AM-IMP-2026.0612.03 Codex command LLM triage

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.03.md`.

## Summary

Pending Codex commands are triaged every 15 minutes: pure analysis answered and marked Done; sensitive or action-requiring commands marked Needs Confirmation with a proposed plan.

## Changes

- Added scripts/llm-codex-command-triage.js with --reply for instant LINE answers (controller-only).
- render.yaml seven-jr-codex-command-triage cron (*/15).

## Type

LINE command

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

Pending Codex commands are triaged every 15 minutes: pure analysis answered and marked Done; sensitive or action-requiring commands marked Needs Confirmation with a proposed plan.
