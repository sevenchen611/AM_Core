# AM-IMP-2026.0612.12 Controller-only command gate

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.12.md`.

## Summary

Incident 2026-06-12: calibration reply interception accepted text from any conversation, leaking calibration review content into business groups and polluting 4 cases. Fix: calibration commands/replies, task list/detail queries, report links, and command acknowledgements respond only to the controller in a 1-on-1 chat; triage instant replies only answer controller-issued commands.

## Changes

- server.js isControllerPersonalChat gate across buildCommandReply.
- Triage maybeReply checks command User ID against SEVEN_CONTROLLER_USER_ID.
- 4 polluted cases quarantined; 4 task summaries cleaned; incident documented in AGENTS.md.

## Type

Safety (incident fix)

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

Incident 2026-06-12: calibration reply interception accepted text from any conversation, leaking calibration review content into business groups and polluting 4 cases
