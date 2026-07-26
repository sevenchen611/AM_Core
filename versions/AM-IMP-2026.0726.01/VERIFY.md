# Verify

## Local

Run:

```text
node --check modules/reminders/index.js
node --check modules/construction/reminders.js
node --check modules/construction/index.js
node --check modules/construction/dashboard.js
node tools/check-upgrade-package.js AM-IMP-2026.0726.01
```

Recommended broader regression:

```text
npm run dryrun:engineering
```

## Production

After Render deployment:

1. Confirm `https://am.hozorental.com/health` returns `ok: true`.
2. Open a dashboard deep link with a valid engineering page id:

   ```text
   https://am.hozorental.com/dashboard?tenant=engineering&doc=<page-id>
   ```

3. Confirm AM Portal authorization still applies.
4. Confirm the dashboard opens the referenced page in the editable modal.
5. Trigger or wait for a safe reminder cycle and confirm LINE messages include `開啟任務:` or `開啟單據:` only for configured tenants.
