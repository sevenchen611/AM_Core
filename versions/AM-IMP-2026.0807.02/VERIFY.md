# Verify

Local:

```text
node --check core/bootstrap.js
node --check modules/calendar/index.js
node tools/dryrun-calendar-line-operations.mjs
node tools/dryrun-tasks.mjs
node tools/audit-module-authorization.mjs
node tools/dryrun-personal-line-routing.mjs
```

Production:

1. `/health` lists `calendar` under HOZO AM 2.0 requested and loaded modules.
2. `我的今天` returns only the bound person's items.
3. A create command does not write until `確認新增` is received.
4. `完成 1`, `延到明天 1`, `改期 1 <date>`, and `取消 1` update only
   `personal_edit` items.
5. AM-originated items remain visible but reject Calendar-side mutation.
