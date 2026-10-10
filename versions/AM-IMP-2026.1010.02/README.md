# Text-first calendar supplementation

Status: Deployed in the root AM Platform service, verified 2026-10-10. Reviewed PR #279 passed full CI and main `71226fde7722b8dc00c6e803a371c952519f8091` is live. Activity cards show red missing/uncertain fields and inline text supplementation instructions, with exactly two actions: 建立 and 不參加. Actual missing required fields block creation with a precise text reply. A displayed valid year assumption can be accepted by clicking 建立; it no longer requires typing the year again.

Direct field corrections and explicit 補充活動 text update the existing source-backed draft, produce one revised card and still require owner confirmation. Multiple drafts require an exact activity title in 補充活動《活動名稱》：…; ambiguous targets never mutate a draft. Old edit buttons explain text supplementation without resetting revision or resending the unchanged card.

Existing pending cards can be refreshed once through the exact-live-commit operator tool. Request identity, event fields and raw source are preserved, card revision increments to invalidate old buttons, and established/closed/expired/leased drafts are excluded. No new identity, tenant, Google permission or calendar configuration is introduced.

Production validation accepted a synthetic red/two-action card without sending it. The operator refreshed one intended pending legacy card; LINE accepted its current revision with the requested labels and red warnings, and outgoing archival completed. Necessary fields are complete and owner confirmation remains pending. Recovery did not create a Google event. Standalone project adoption remains separate.
