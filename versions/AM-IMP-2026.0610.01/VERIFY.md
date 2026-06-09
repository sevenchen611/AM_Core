# Verify

## Local Checks

- `render.yaml` has exactly one morning brief cron and it uses `30 0 * * *`.
- No non-morning cron service was changed from its existing schedule.
- LINE/report copy says 08:30 or 早上 8 點半 for morning brief messages.
- Any 08:00-22:00 hourly LINE task reconciliation language remains unchanged.

## Production Checks

Before marking `Deployed`:

- Confirm the Render cron service schedule is `30 0 * * *`.
- Confirm the next run shown by Render corresponds to 08:30 Asia/Taipei.
- Confirm the next morning report send leaves a LINE or report-run evidence record.
