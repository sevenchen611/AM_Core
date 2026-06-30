# AM-IMP-2026.0630.01 Two-way Google Calendar sync and invite confirmation

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-30-AM-IMP-2026.0630.01.md`.

## Summary

Two-way Google Calendar sync and invite confirmation for SevenAM. SevenAM writes
confirmed project deadlines/checkpoints and LINE-sourced invitations to a
dedicated "SevenAM" Google Calendar with reminders; unconfirmed invites are
chased in preset windows before auto-creating. Design and locked decisions:
AMCore `docs/SEVENAM_CALENDAR_INTEGRATION.md`.

## Type

Scheduling / Calendar (SevenAM-specific)

## Project Status At Backfill

- HOZO AM: 未列入
- 7AM: Installed

## Registry Note

SevenAM-ONLY by request. Writes confirmed project deadlines/checkpoints and LINE-sourced invitations to the controller's Google Calendar; unconfirmed invites are chased in default reminder windows before auto-creating. Design: AMCore `docs/SEVENAM_CALENDAR_INTEGRATION.md`. Builds on 0608.20 (read-only agenda), 0612.02 (LLM extraction), 0612.14 (Next Action scheduler). HOZO not in scope.
