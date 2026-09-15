# Verify

Run:

```text
npm run dryrun:claims-authority
npm run dryrun:finance-v3-direct
node tools/check-upgrade-package.js AM-IMP-2026.0915.02
node tools/audit-alignment.js
```

Production canary:

1. In one published vendor group, an ordinary current member enters `請款`.
2. LINE identity verification opens the assigned form chooser.
3. The first selected legacy form opens without `請款身分尚未啟用`.
4. V3 opens for the same member without an internal admin account.
5. Disable that member in claims management and confirm a new selector link is denied.
6. Confirm no raw LINE identifier appears in AM delivery-ledger JSON or ordinary logs.
