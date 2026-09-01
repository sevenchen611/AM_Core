# HOZO AM 2.0 — Project Improvement Manifest

Tenant key: `hozo-am-2-0`  
Tenant UUID: `a72c78d7-5035-4e6e-8caf-9ec4d58c914f`  
Environment prefix: `HZ2`

| Version | Status | Capability | Scope | Notes |
| --- | --- | --- | --- | --- |
| AM-IMP-2026.0718.01 | Deployed | Operational memory | Raw evidence → events → project/task state → decisions/knowledge | Notion, Drive, 15 data sources and the shared PostgreSQL tenant row are live. PostgreSQL 18, separated runtime role, forced RLS and Render production health passed. |
| AM-IMP-2026.0803.01 | Deployed | Full workflow activation | Formal tasks, reminders, queue, group admin, triage, meeting todo creation | HOZO AM 2.0 tenant authorization is enabled, full workflow modules are loaded, meeting tasks can reach review-and-create mode, and new HOZO AM 2.0 group onboarding defaults to active full-function binding. |
| AM-IMP-2026.0803.02 | Deployed | Group name repair | LINE group-summary name resolution and same-tenant binding repair | Production health reports `group-name-repair-2026-08-03`; legacy onboarding no longer writes a fixed historical group name. |
| AM-IMP-2026.0804.01 | Deployed | Claims group governance | Claim capability, stable LINE sender allowlist, claims LIFF and Rental integration configuration | Claims is enabled only for the provisioned source group after the additive schema, secure runtime configuration, Rental intake, source, and approver checks were verified in production. |
| AM-IMP-2026.0806.01 | Deployed | Claims shortcut card | LINE Flex claim-entry card and quick-reply URI button | Claim commands now return a visible `開啟請款單` button card in eligible HOZO AM 2.0 groups while preserving the signed LIFF session, submitter allowlist and fallback push behavior. |
| AM-IMP-2026.0806.02 | Deployed | Personal LINE identity routing | One-to-one LINE user ID binding and tenant-safe private dispatch | Production health confirms HOZO AM 2.0 now requests and loads `personal-assistant`; identity derives only from exact user IDs in formally enabled HOZO AM 2.0 group member maps, ambiguous or lookup-failure cases fail closed, and direct messages never enter group collection modules. Fresh LINE user reply verification remains the next live check. |
| AM-IMP-2026.0807.01 | Installed | Private LINE claims entry | Rich Menu `我要請款` text action to signed LIFF claim form card | Direct claims resolve the exact LINE user ID against active allowlisted claim-source bindings and require exactly one source; local syntax and dry-run verification are complete, while production Rich Menu and LIFF opening remain to be verified. |
| AM-IMP-2026.0807.02 | Deployed | Personal Calendar LINE operations | Personal queries, confirmed creates, numbered updates and evidence-backed AM task projection | Rental Calendar deploy `aae1796` and AM Platform deploy `680b58b` are live. Production smoke tests resolved Seven, queried personal items, created and cancelled a `personal_edit` item, projected and closed a `view_only` AM item, rejected personal mutation of that source item, and completed the deployed LINE command flow without warnings. |
| AM-IMP-2026.0807.03 | Installed | Rich Menu action binding | Six private assistant Rich Menu labels route to calendar, claims and identity behavior | Runtime aliases and guarded `新增待辦` guidance are implemented and dry-run verified. A non-secret Rich Menu action contract and optional apply script are included; live LINE API application still requires project-local `LINE_CHANNEL_ACCESS_TOKEN`. |
| AM-IMP-2026.0808.01 | Deployed | Unified private assistant tasks | Zero-migration cutover from Rental Calendar personal tasks to AM task-backed private assistant todos | Production health confirms HOZO AM 2.0 no longer loads `calendar`; the direct assistant now parses multi-item private todos, previews them before `確認新增`, writes confirmed items to AM tasks, reads personal today/week/yesterday lists from AM tasks, suppresses repeated non-text identity fallback, disables Calendar projection by default, and pins the tenant MiniMax backend to `MiniMax-M3`. |
| AM-IMP-2026.0811.05 | Ready | Claim bank-review source-group notice | Structured Rental event to the original claim LINE binding | The fixed message includes the original title, reviewed amount, and scheduled bank date or an explicit unplanned fallback; it also states that bank review approval is not final release or credit. Production deployment and next-genuine-review delivery remain to be verified. |
| AM-IMP-2026.0813.01 | Installed | Interactive LINE task control | Flex task list, task completion, progress/blocker/next-step/keyword capture, completed-task search | Runtime and schema are installed. The first one-to-one Rich Menu canary exposed missing direct-card delegation/postback routing; the repair adds owner/group scope and explicit query timeouts. Keep `Installed` until the repaired direct and group production canaries pass. |
| AM-IMP-2026.0831.05 | Superseded | Durable Finance Claims v3 ingress | Tenant-scoped PostgreSQL processing queue, fast leases, cold-start retry and terminal private failure notice | Superseded by the direct AM Platform owner model in `AM-IMP-2026.0901.01`; accepted pending/retry rows must be reconciled before cutover and completed history remains for audit. |
| AM-IMP-2026.0901.01 | Deployed | Direct Finance Claims v3 owner | AM Platform pre-ack persistence, database idempotency, staged retry and LINE notification ledger | Production cutover and the HOZO finance-group canary passed on 2026-09-01: the v3 link was privately delivered by 葉小蝸 AI 小助手, the new receipt/OCR form returned 200, a transient Rental warmup recovered through the durable retry state, and replaying the same LINE event produced no duplicate row or message. |
| AM-IMP-2026.0901.02 | Installed | Production Finance Claim entry message | Replace the canary-labelled private entry message with the production template | Runtime and dry-run coverage are installed. Production status waits for the merged Render deploy and a fresh authorized finance-group entry message without the test marker. |
| AM-IMP-2026.0901.04 | Installed | Finance Claim 10-minute entry compatibility | Accept Rental's ten-minute signed source hint in the bridge and durable entry consumer | Runtime and direct dry-run coverage are installed. Production status waits for the merged Render deploy and a fresh authorized finance-group entry. |
| AM-IMP-2026.0901.05 | Installed | Finance Claim entry delivery TTL alignment | Apply the same ten-minute signed source-hint ceiling at the final LINE private-message delivery boundary | Runtime and regression coverage are installed. Production status waits for the merged Render deploy and a fresh authorized finance-group entry that reaches `delivered`. |

## Tenant boundaries

- This is a new AM Platform tenant. It is not a migration or rename of `hozoam`.
- Existing `tenants/hozoam.json` and the standalone HOZO_AM project remain untouched.
- Notion parent is stored only in the platform `.env` under `HZ2_NOTION_PARENT_PAGE_ID`.
- Google Drive root is stored only in the platform `.env` under `HZ2_DRIVE_ROOT_FOLDER_ID`.
- Live messages, tasks, decisions, knowledge, attachments and logs must remain tenant-local.

## Activation history

The initial activation gate below was closed while HOZO AM 2.0 was in shadow onboarding. On 2026-08-03, `AM-IMP-2026.0803.01` moved the tenant into full workflow mode after Notion, Drive, PostgreSQL RLS, group routing and production health checks had passed.

Existing group binding rows that were created before this activation may still carry `狀態=影子記錄`. Those rows must be upgraded to `狀態=啟用`, `啟用功能=訊息收集/待辦/會議/案件狀態/照片/提醒`, and `會議待辦模式=完整確認` before they can create formal tasks.

## Initial activation gate

The tenant stayed at `authorizationReady=false`, meeting formal task creation disabled and operational memory in shadow mode until all of these passed:

1. The Notion integration can access the declared parent page.
2. Tenant-local Notion data sources are provisioned and recorded under `HZ2_*`.
3. The Drive identity can access only the declared tenant root for this workflow.
4. The PostgreSQL tenant row and forced-RLS isolation checks pass.
5. At least one HOZO AM 2.0 LINE group is explicitly bound in shadow mode.
6. Raw evidence, idempotency, candidate extraction and cross-tenant denial are verified.

## Shared PostgreSQL connection

`operationalMemory.connectionEnvPrefix=FOREST` deliberately reuses the existing restricted shared-database runtime credential in Render without copying or exposing it. Isolation does not depend on the environment-variable name: every transaction sets HOZO AM 2.0's own tenant UUID, and forced PostgreSQL RLS must deny missing or different tenant contexts.
