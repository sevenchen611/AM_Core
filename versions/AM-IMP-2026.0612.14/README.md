# AM-IMP-2026.0612.14 Planned messages and Next Action scheduling

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.14.md`.

## Summary

Every task can carry a pre-approved outgoing message, its recipient (including a dynamically chosen next actor), and a scheduled Next Action. A 15-minute scheduler fires due actions: auto-send mode pushes the approved message to LINE and flips the task to 等待回覆; remind mode pings the controller with the action note, draft, and dashboard link. Dead-man-switch semantics: if the prior step happens, the user redefines the timer; if nobody acts, it fires as defined.

## Changes

- Six auto-created task properties: 預定訊息內容, 預定發送對象, 預定發送對象ID (`type:id`), 下次行動時間 (one-shot, cleared after firing), 下次行動模式 (提醒我/自動發送), 下次行動說明.
- Dashboard task page: 預定訊息與下次行動 panel — draft textarea, recipient search reusing `/reports/followup-recipient-candidates` (send to the next actor, not just the owner), mode select, datetime picker with +1/3/5/7-day quick buttons, save (`/control/tasks/update` extended) and 立即發送.
- `POST /control/tasks/send-planned`: sends now, persists the used message/target as the task defaults, logs to the task body, sets 等待回覆＋已確認, auto-snoozes 2 days.
- Review pages section 2: chase textarea prefills from 預定訊息內容; new 「排程 1/3/5/7 天後自動發出」 options post `scheduledSends` to `/control/reports/approve` (writes message + fire time + 自動發送, snoozes tracking until fire time).
- `scripts/run-scheduled-actions.js` + Render cron `seven-jr-scheduled-actions` (every 15 min). Auto-send failures defer +2h and alert the controller; missing content/target degrades to a reminder.

## Type

Task control / Scheduling

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

Tasks carry a pre-approved message, recipient (next-actor picker), and one-shot Next Action timer; a 15-minute scheduler auto-sends or reminds the controller (dead-man-switch semantics).
