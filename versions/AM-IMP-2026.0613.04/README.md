# AM-IMP-2026.0613.04 Queue database plan policy

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-13-AM-IMP-2026.0613.04.md`.

## Summary

Queue-database plan policy: the event queue Postgres must live next to the webhook (cloud), never on the worker machine — the queue's reliability must exceed what it protects. Production projects use a paid plan (no 30-day expiry); the account's single Render free-Postgres slot is reserved for the current test project.

## Changes

- SevenAM render.yaml: `sevenam-queue-db` plan free → `basic-256mb` (~$6/月), permanently removing the 7/11 free-tier expiry deadline.
- HOZO render.yaml: `hozoam-queue-db` plan free takes the released slot for the test period (upgrade one line when productionizing).
- Documented Render constraints discovered live: one free Postgres per account; Blueprint sync creates/updates but never deletes — removed resources must be deleted manually in the dashboard.

## Type

Infrastructure / Governance

## Project Status At Backfill

- HOZO AM: Installed
- 7AM: Installed

## Registry Note

Queue Postgres lives next to the webhook in the cloud; production uses a paid plan (no expiry); the single Render free-Postgres slot is reserved for the active test project.
