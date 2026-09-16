# Verify

Run:

```text
npm run dryrun:claims-authority
node tools/check-upgrade-package.js AM-IMP-2026.0916.01
node tools/audit-alignment.js
```

Production checks:

1. `/health` returns 200 and claims authority is ready.
2. The admin group table shows both group modes.
3. External groups cannot receive `employee_expense`.
4. An external legacy selector does not call Finance membership onboarding.
5. Internal V3 selectors continue to require the Finance membership bridge.
6. FORCE RLS permits only the platform-owner read required for notification resolution; tenant writes remain tenant-scoped.
