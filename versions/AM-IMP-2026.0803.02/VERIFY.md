# Verify

## Local

```text
node --check core/line.js
node --check server.js
node tools/dryrun-core.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0803.02
```

## Production

1. Confirm `/health` reports build `group-name-repair-2026-08-03`.
2. From an already-bound HOZO AM 2.0 group, send either supported onboarding command.
3. Confirm the reply identifies the current LINE group name.
4. Confirm the tenant-local Group Bindings row has the same `LINE 群組 ID` as before and its `群組名稱` matches the LINE group summary.
5. Confirm the row's status, capabilities, meeting mode, and project relation were not changed by the repair.
6. Send a normal message and confirm it routes only to the same tenant.
