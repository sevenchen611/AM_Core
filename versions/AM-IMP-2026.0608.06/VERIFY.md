# Verify

## Local

- `node --check src/control-api.js`
- `node --check scripts/render-cron-report.js`
- Preview daily report with no LINE send.

## Pass Criteria

- Preview returns `ok: true`.
- Preview response includes daily report text.
- `wouldSend` remains false for preview.
- No other project's Notion IDs are used.

