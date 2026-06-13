# AM-IMP-2026.0612.02 LLM task extraction service

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.02.md`.

## Summary

Hourly conversation-to-task judgment runs as a service calling Claude with structured output, replacing the keyword rule engine; falls back to the legacy engine when no API key is set.

## Changes

- Added scripts/llm-task-extraction.js: conversation timeline judging, JSON schema output, task creation with 待確認, evidence updates, conversation judged marking.
- render.yaml judgement-sync cron switched to the LLM script.

## Type

Task control

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

Hourly conversation-to-task judgment runs as a service calling Claude with structured output, replacing the keyword rule engine; falls back to the legacy engine when no API key is set.
