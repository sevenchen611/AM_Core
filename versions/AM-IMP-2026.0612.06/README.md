# AM-IMP-2026.0612.06 Extraction trustworthiness instruments

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.06.md`.

## Summary

Confidence calibration stats (measured confirm rates per level) are injected into the extraction prompt once a level has 5+ labeled cases; borderline suppressions are sampled into the case database as the false-negative guard; an eval harness scores the judgment core against user verdicts.

## Changes

- Extraction computes and injects per-confidence confirm rates.
- Borderline suppressed items (max 2/conversation) recorded as Case Status=New.
- Added scripts/eval-extraction.js (accuracy/precision/recall/per-confidence, --save).

## Type

Learning / Quality

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

Confidence calibration stats (measured confirm rates per level) are injected into the extraction prompt once a level has 5+ labeled cases; borderline suppressions are sampled into the case database as the false-negative guard; an eval harness scores the judgment core against user verdicts.
