# AM-IMP-2026.0612.05 Calibration feedback loop

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.05.md`.

## Summary

User confirm/merge/reject decisions on LINE-sourced tasks are captured nightly into the judgment calibration case database; rejections generate Claude-proposed rules (Needs review) and Active rules are injected into the extraction prompt.

## Changes

- Added scripts/sync-extraction-feedback.js (verdict capture, idempotent by Source Task relation, rule suggestions, per-confidence stats).
- Extraction loads Status=Active rules each run.
- render.yaml seven-jr-extraction-feedback-sync cron (22:45 Taipei).

## Type

Learning

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

User confirm/merge/reject decisions on LINE-sourced tasks are captured nightly into the judgment calibration case database; rejections generate Claude-proposed rules (Needs review) and Active rules are injected into the extraction prompt.
