# AM-IMP-2026.0610.01 Morning Brief 08:30 Schedule Standard

This package changes the standard AM morning brief time from 08:00 to 08:30 in each project-local timezone.

## Purpose

The morning brief should arrive after the early morning intake window has enough time to settle, while still remaining early enough to guide the day's work.

## Standard

| Item | Value |
| --- | --- |
| Local report time | 08:30 |
| Asia/Taipei Render cron | `30 0 * * *` |
| Report type | `morning` |
| Render command | `npm run cron:report -- morning` |

## Scope

Apply this package to each AM-style production project separately:

- HOZO_AM
- SevenAM

This package does not change the 08:00-22:00 hourly LINE task reconciliation window. That hourly window is a separate control loop.

## Definition Of Done

- AMCore shared report slot rules define the morning brief as 08:30.
- Each project-local `render.yaml` changes only the morning brief cron from `0 0 * * *` to `30 0 * * *`.
- Each project-local report copy says 08:30 / 早上 8 點半.
- Project manifests and upgrade records record the install separately.
- Production Render schedule is verified before marking a project `Deployed`.
