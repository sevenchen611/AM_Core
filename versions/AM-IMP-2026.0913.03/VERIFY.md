# Verify

Run:

```text
node tools/dryrun-claims-authority-admin.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0913.03
node tools/audit-alignment.js
```

Production verification:

1. Open `/claims-authority?tenant=hozo-am-2-0` without a valid AM Platform session.
2. Confirm a recovery page appears instead of JSON.
3. Select the recovery action while logged into the HOZO finance admin.
4. Confirm a fresh one-time handoff returns to the authorized claims administration page.
5. Confirm all four form preview actions still open and remain non-mutating.
