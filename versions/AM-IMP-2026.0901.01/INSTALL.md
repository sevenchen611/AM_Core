# Install

1. Deploy the merged AM Platform commit through the normal Render deployment from `main`.
2. Configure the `HZ2_FINANCE_CLAIMS_V3_*` environment values with the existing Finance Claims v3 PostgreSQL database, Rental bridge credentials, opaque recipient bindings and group scopes.
3. Keep AM's existing global `LINE_CHANNEL_ACCESS_TOKEN`; it is the 葉小蝸 AI 小助手 channel and must not be replaced by the retired HOZO AM token.
4. Keep the new AM group-entry flag off. Disable the former HOZO-AM drainer first and wait for every in-flight lease/request to finish.
5. Run `npm run inventory:finance-v3-legacy` against the existing restricted operational-memory database. Exit code 0 proves `activeCount=0`; exit code 2 means queued/retry/leased jobs remain. Drain them with the old sole owner, or replay each pending/retry event into the new canonical ingress and explicitly settle the old job. Save the sanitized JSON count output with the release record. Do not abandon an event that LINE already received 200 for.
6. Verify AM receiver and bridge readiness, then update Rental's Finance Claims v3 LINE gateway upstream to `https://am.hozorental.com`.
7. Enable `HZ2_FINANCE_CLAIMS_V3_GROUP_ENTRY_ENABLED` only after the old owner is quiescent and the accepted-job inventory is zero or reconciled.
8. Preserve the database and all prior ledgers during cutover.
