# AM-IMP-2026.0612.11 Dual-mode local worker

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.11.md`.

## Summary

The judgment brain runs on a pluggable backend: api (Anthropic API on Render crons) or claude-code (local CLI headless on subscription quota). A 24/7 local worker runs extraction+triage every ~90s with instant command replies and heartbeats to Render; crons stand down while the heartbeat is fresh and take over automatically when it stops.

## Changes

- Added src/llm-backend.js (completeJson contract, env cleaning for nested CLI calls, JSON repair).
- Added scripts/local-worker.js (auth self-test exit 2, 3-failure heartbeat suspension) and start-local-worker.ps1 (crash restart).
- event-queue worker_heartbeats table; server.js /worker/heartbeat (control-key) and /worker/status.
- run-cron-with-alert.js AM_SKIP_IF_WORKER_ACTIVE gate on judgement and triage crons.

## Type

Architecture

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

The judgment brain runs on a pluggable backend: api (Anthropic API on Render crons) or claude-code (local CLI headless on subscription quota)
