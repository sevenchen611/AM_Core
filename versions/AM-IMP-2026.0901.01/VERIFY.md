# Verify

Run locally:

```text
npm run dryrun:finance-v3-direct
npm run check
npm run dryrun
node tools/check-upgrade-package.js AM-IMP-2026.0901.01
npm run inventory:finance-v3-legacy
```

Production canary:

1. Confirm AM receiver and bridge capability endpoints are ready.
2. Send exactly `請款` once from an allowlisted user in the HOZO finance group.
3. Confirm the LINE webhook returns 200 only after one durable local record exists.
4. Confirm one private v3 form link arrives from 葉小蝸 AI 小助手 and no legacy card appears.
5. Replay the same LINE event and confirm no second record or message is created.
6. Confirm a transient Rental or LINE failure moves to a retry/reconciliation state and later completes without duplicate delivery.
7. Confirm Rental approval/payment notifications still drain from its notification outbox.
