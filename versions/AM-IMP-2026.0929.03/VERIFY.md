# Verify

```text
node --test tools/test-line-io.mjs tools/test-line-directory.mjs
node tools/test-line-io-sql.mjs <installed-pglite-dist-index.js>
node --experimental-vm-modules tools/verify-bank-line-reply-intake.mjs
node tools/verify-line-push-timeout.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0929.03
```

The real disposable PostgreSQL directory tests verify persistence, stale/out-of-order webhook redelivery, no message-content storage, unbound-group intake before acknowledgement, operator auth/scope restrictions, scoped tenant reassignment denial, pagination, partial Notion scans, provider 403 fallback, profile failures and active-member semantics.

Production: verify health version 1.2.0 and directoryEnabled=true at the merged main SHA. Query all directory pages using the owner catalog key; retain results only in caller-private storage. Confirm a known IO group is selectable and indicates its configured transport status. Query members and verify the known human's active ID. Verify no-token 401, catalog-key events/messages 403, ordinary key rejection of another group's members, invalid pagination 400. Discovery must not push any LINE message.

Do not claim a complete OA group inventory or complete fallback membership. A real new-group webhook canary requires a human group message; LINE delivery tests with empty events do not prove discovery. Run the AMCore alignment audit and record pre-existing legacy project gaps separately from this package's integrity.
