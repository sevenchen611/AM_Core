# AM-IMP-2026.0612.15 System operating hours

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.15.md`.

## Summary

System operating hours: all 15-minute scanning (command triage, attachment parsing, Next Action scheduled actions) and the resident AI local worker run Taipei 07:00-23:00 and rest 23:00-07:00. Overnight-due scheduled actions fire on the first morning scan; night commands queue and are answered after 07:00.

## Changes

- render.yaml: the three 15-minute crons restricted to UTC `0-14,23` (Taipei 07:00-22:45 last run).
- scripts/local-worker.js: active-hours gate (`SEVEN_WORKER_ACTIVE_HOUR_START`/`SEVEN_WORKER_ACTIVE_HOUR_END`, default 7/23, Taipei). Outside the window the worker pauses scanning AND heartbeats (5-minute time checks); on resuming it sends an immediate heartbeat so Render crons stand down without racing.
- AGENTS.md: System operating hours section under Scheduled Reports.

## Type

Scheduling / Governance

## Project Status At Backfill

- HOZO AM: Installed
- 7AM: Installed

## Registry Note

15-minute crons and the resident AI worker run only during configured active hours (default Taipei 07:00-23:00); the worker pauses scans and heartbeats overnight and resumes with an immediate heartbeat.
