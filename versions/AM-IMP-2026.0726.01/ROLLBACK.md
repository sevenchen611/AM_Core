# Rollback

Rollback does not require deleting Notion records, LINE messages, Render services, or AMCore package files.

To disable the behavior:

1. Revert the code changes in:
   - `modules/reminders/index.js`
   - `modules/construction/reminders.js`
   - `modules/construction/index.js`
   - `modules/construction/dashboard.js`
2. Redeploy AM Platform to Render.
3. Verify reminders still send without `開啟任務:` and `開啟單據:` lines.

If the public URL is misconfigured, set `ENG_PUBLIC_BASE_URL` or `AMCORE_PUBLIC_BASE_URL` to the correct production base URL and redeploy. The reminder code fails closed by omitting the link when no public base URL is available.
