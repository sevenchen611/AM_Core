# Rollback

If the LINE group-summary endpoint is unavailable or the new behavior must be withdrawn, revert only the code changes in:

- `core/line.js`
- `core/bootstrap.js`
- `core/group-onboarding.js`
- `server.js`

Then redeploy AM Platform. Do not delete or recreate Group Bindings rows: the existing `LINE 群組 ID` is the authoritative routing key and remains valid.
