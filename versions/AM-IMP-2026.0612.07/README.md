# AM-IMP-2026.0612.07 Extraction prompt hardening

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.07.md`.

## Summary

Nine-point hardening of the extraction prompt: timeline wrapped as data-not-instructions (prompt injection guard), new/background message gating against 最後任務判斷訊息時間 (duplicate guard), schema mapping section, few-shot examples, message-time-based relative dates, max 5 tasks per conversation, evidence-gated status changes, real 母任務 relation linking, sensitive tasks forced to 優先級=高.

## Changes

- scripts/llm-task-extraction.js system prompt and user message restructured; parseTaipeiDisplayTime ported; maybeLinkParentTask added; --print-system-prompt debug flag.

## Type

Safety / Quality

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

Nine-point hardening of the extraction prompt: timeline wrapped as data-not-instructions (prompt injection guard), new/background message gating against 最後任務判斷訊息時間 (duplicate guard), schema mapping section, few-shot examples, message-time-based relative dates, max 5 tasks per conversation, evidence-gated status changes, real 母任務 relation linking, sensitive tasks forced to 優先級=高.
