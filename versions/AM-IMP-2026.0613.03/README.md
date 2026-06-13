# AM-IMP-2026.0613.03 Local-worker schedule consolidation

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-13-AM-IMP-2026.0613.03.md`.

## Summary

Local-worker schedule consolidation: the 24/7 worker becomes the primary scheduler, absorbing the Render crons. Each worker cycle runs extraction + triage; every 15 minutes the Next Action scan; hourly the meeting-action and responsibility-candidate syncs; the five daily reports fire at 08:30 / 10:00 / 13:00 / 17:00 / 20:30 inside a 30-minute grace window (missed windows are skipped, never back-filled stale); nightly 22:20 proposals and 22:45 feedback sync. Render keeps only what the worker cannot or should not own.

## Changes

- `scripts/local-worker.js` (both projects): 15-min/hourly interval tracking, REPORT_TIMETABLE with grace window (reports POST through `scripts/render-cron-report.js` to the webhook's `/control/reports/send`), nightly run-once-per-day markers.
- SevenAM render.yaml: 13 crons → 3 (extraction + triage API fallbacks with worker-heartbeat stand-down, and attachment parsing which requires the Anthropic API for vision). HOZO render.yaml: zero crons (Codex-only, no fallback by design).
- `.env`: CONTROL_API_URL added for the worker-driven report sends.
- Frees ~10 Render resource slots per the 25-per-workspace cap and their starter-plan cron costs.

## Type

Scheduling / Architecture

## Project Status At Backfill

- HOZO AM: Installed
- 7AM: Installed

## Registry Note

The worker is the primary scheduler (cycles, 15-min, hourly, daily reports with grace window, nightly batches); Render keeps only API fallbacks (7AM) or nothing (HOZO Codex-only).
