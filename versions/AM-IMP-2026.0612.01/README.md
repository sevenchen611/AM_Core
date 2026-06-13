# AM-IMP-2026.0612.01 Durable LINE event queue

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.01.md`.

## Summary

LINE webhook events are stored in Postgres before Notion processing, so messages survive Notion outages, rate limits, and restarts.

## Changes

- Added src/event-queue.js (line_event_queue table, FOR UPDATE SKIP LOCKED claims, retry backoff 30s-2h, dead-letter status).
- Webhook enqueues then replies 200; background worker writes to Notion; reply failures are non-fatal.
- Dead-letter events push a LINE alert to SEVEN_ALERT_TARGET_ID.
- GET /health reports eventQueue stats.
- render.yaml defines sevenam-queue-db Postgres; pg dependency added.

## Type

Reliability

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

LINE webhook events are stored in Postgres before Notion processing, so messages survive Notion outages, rate limits, and restarts.
