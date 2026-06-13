# Install AM-IMP-2026.0612.14

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.14.md`.

## Changes To Apply

- Six auto-created task properties: 預定訊息內容, 預定發送對象, 預定發送對象ID (`type:id`), 下次行動時間 (one-shot, cleared after firing), 下次行動模式 (提醒我/自動發送), 下次行動說明.
- Dashboard task page: 預定訊息與下次行動 panel — draft textarea, recipient search reusing `/reports/followup-recipient-candidates` (send to the next actor, not just the owner), mode select, datetime picker with +1/3/5/7-day quick buttons, save (`/control/tasks/update` extended) and 立即發送.
- `POST /control/tasks/send-planned`: sends now, persists the used message/target as the task defaults, logs to the task body, sets 等待回覆＋已確認, auto-snoozes 2 days.
- Review pages section 2: chase textarea prefills from 預定訊息內容; new 「排程 1/3/5/7 天後自動發出」 options post `scheduledSends` to `/control/reports/approve` (writes message + fire time + 自動發送, snoozes tracking until fire time).
- `scripts/run-scheduled-actions.js` + Render cron `seven-jr-scheduled-actions` (every 15 min). Auto-send failures defer +2h and alert the controller; missing content/target degrades to a reminder.

## Environment Variables (names only)

None.

## Data Isolation Check

Uses only SevenAM LINE channel, Notion data sources, and Render service. No secrets or data copied from another project.
