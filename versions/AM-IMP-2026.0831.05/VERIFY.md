# Verify

Run:

```text
npm run dryrun:processing-jobs
npm run dryrun:finance-v3-gateway
npm run check
node tools/check-upgrade-package.js AM-IMP-2026.0831.05
```

Production canary:

1. Let the downstream free service enter its cold state.
2. Send exactly `請款` from an allowlisted member in the HOZO finance group.
3. Confirm AM persists one `finance_claim_v3_group_entry` job using the LINE event id.
4. Confirm no legacy claim card and no premature group success notice appears.
5. Confirm the same job is retried and becomes `succeeded` after the downstream service wakes.
6. Confirm one v3 card appears in the original group and no duplicate card appears after another drain pass.
