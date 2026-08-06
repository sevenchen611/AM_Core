# Verify

Run locally:

```text
node --check server.js
node --check core/bootstrap.js
node --check modules/personal-assistant/index.js
node tools/dryrun-personal-line-routing.mjs
node tools/dryrun-personal-calendar-binding.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0806.03
node tools/audit-module-authorization.mjs
node tools/audit-alignment.js
```

Rental must additionally pass its Calendar foundation contract test, migration
parse-and-rerun check, runtime issue/consume/replay/resolve/revoke test, syntax
check, existing finance regressions and paired admin page check.

Production verification requires a fresh known HOZO AM 2.0 LINE event:

1. Authenticate in Rental Portal and request one binding code.
2. Send `綁定 123456` from the same already-resolved one-to-one LINE account.
3. Confirm Rental returns one active link for the correct `admin_users.id`.
4. Repeat the same event with the same idempotency key and confirm no duplicate link.
5. Try expired, reused, wrong-user, revoked and conflicting bindings; all must fail closed.
6. Confirm the reply contains no raw LINE user ID, code, token or private data.
