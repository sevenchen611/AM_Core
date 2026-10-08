# Green Hotel AM improvement manifest

| Version | Status | Scope | Verified | Notes |
| --- | --- | --- | --- | --- |
| AM-IMP-2026.1007.03 | Deployed | OA-owned per-conversation central LINE evidence archive; tenant business sources retained | Real PostgreSQL, source isolation, full text, Drive-only binaries, retry recovery and signed webhook checks | Production main f1f68d5 verified live on 2026-10-07 with capture enabled, verified legacy file references and bounded batches. Historical availability and completion are tracked in the target-local owner archive. |
| AM-IMP-2026.1006.07 | Deployed | Confirm private LINE activity before Google Calendar creation | Reviewed main 19accd0, forced RLS schema, encrypted shared service setup and live configured tenant | Uses existing verified UOF direct bindings and DailyLog Google/calendar settings; no event created by deployment verification. |
| AM-IMP-2026.1004.07 | Deployed | Retrieve archived LINE attachments | Exact quote or complete filename in the same conversation; verified Drive link | Main e92dc4c live; retrieval contract and tenant archive readiness verified; real LINE delivery remains user acceptance. |
| AM-IMP-2026.1004.06 | Deployed | Drive originals; Notion links only | Production schema, runtime, exact 40 MB canary and completed available-source migration | Code 129dc97 verified; 474 saved indexes with digests, 0 Notion binary references, 8 historical sources need re-upload. |
| AM-IMP-2026.1004.04 | Deployed | Durable attachment preservation | Group/room originals, retries, verified Drive storage and failure notices | Main commit b99dd8c, live ready health and independent 40,647,423-byte tenant storage canary verified; SHA256/MD5 match. Provider redelivery setting awaits login. |
| AM-IMP-2026.0718.01 | Deployed | Shadow operational memory | Source database inventory, PostgreSQL migration, runtime-role separation, forced RLS isolation and Render deployment | Green Hotel uses the shared production PostgreSQL service with its own tenant UUID and restricted runtime role. The previous free test database contained no operational-memory rows, so no business records required copying. |
| AM-IMP-2026.0929.01 | Deployed | Scoped LINE input/output gateway | Render Live main commit, LINE webhook test, authenticated endpoints, unauthorized/group denial, accepted push and duplicate replay | Enabled in production for the configured transport group and fixed user; live user-message input canary remains pending. |
| AM-IMP-2026.0929.02 | Deployed | Per-request LINE @recipient | Main SHA and API 1.1.0 health, explicit recipient push/replay, recipient conflict, invalid/nonmember rejection, old receipt replay | Optional notifyUserId overrides the configured default; null disables @. |
| AM-IMP-2026.0929.03 | Installed | Group/member selector directory | Local PostgreSQL and API isolation checks | Production schema and explicit read-only operator configuration remain pending; no full-inventory claim. |

## Tenant boundary

- Tenant key: `green-hotel`
- Tenant UUID: `6c421e02-7ef7-4f98-8acb-758224689b58`
- PostgreSQL is shared at the service level only. Every Green Hotel row remains isolated by `tenant_id`, forced RLS and a tenant-specific runtime role.
- Shadow mode creates only candidate operational-memory records. Formal tasks, reminders and automatic external replies remain disabled.

| AM-IMP-2026.1008.01 | Deployed | Quoted photo resend and signed original download | 32 retrieval/delivery, 42 retention/archive tests; 19 core checks; webhook and signature route checks | Production main b40cb41 and signed endpoint verified; actual LINE device display remains an acceptance check. |
| AM-IMP-2026.1008.02 | Deployed | Explicit quoted conversation-archive retrieval | 84 attachment/archive tests; server webhook/private pause checks; 19 core checks | Production main 4c0f048 and native recovery/download/delivery verified. Explicit manual archive requests are independent of project activation; source/member gates remain required. |

