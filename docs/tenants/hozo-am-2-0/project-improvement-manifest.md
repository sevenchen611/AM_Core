# HOZO AM 2.0 — Project Improvement Manifest

Tenant key: `hozo-am-2-0`  
Tenant UUID: `a72c78d7-5035-4e6e-8caf-9ec4d58c914f`  
Environment prefix: `HZ2`

| Version | Status | Capability | Scope | Notes |
| --- | --- | --- | --- | --- |
| AM-IMP-2026.0718.01 | Deployed | Operational memory | Raw evidence → events → project/task state → decisions/knowledge | Notion, Drive, 15 data sources and the shared PostgreSQL tenant row are live. PostgreSQL 18, separated runtime role, forced RLS and Render production health passed. |
| AM-IMP-2026.0803.01 | Deployed | Full workflow activation | Formal tasks, reminders, queue, group admin, triage, meeting todo creation | HOZO AM 2.0 tenant authorization is enabled, full workflow modules are loaded, meeting tasks can reach review-and-create mode, and new HOZO AM 2.0 group onboarding defaults to active full-function binding. |
| AM-IMP-2026.0803.02 | Deployed | Group name repair | LINE group-summary name resolution and same-tenant binding repair | Production health reports `group-name-repair-2026-08-03`; legacy onboarding no longer writes a fixed historical group name. |
| AM-IMP-2026.0804.01 | Ready | Claims group governance | Claim capability, stable LINE sender allowlist, claims LIFF and Rental integration configuration | Package and tenant configuration are prepared with claims disabled by default. Activate only after the claims module and Rental claim intake pass their target-environment smoke test. |

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
