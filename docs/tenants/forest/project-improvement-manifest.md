# Forest AM improvement manifest

| Version | Status | Scope | Verified | Notes |
| --- | --- | --- | --- | --- |
| AM-IMP-2026.1010.01 | Deployed | Shared LINE JSON archive comparison | User/group/room push/reply regression, full CI and live main aedbf53 | Root service fix covers common outbound evidence; no calendar enrollment or tenant permission change. |
| AM-IMP-2026.1007.03 | Deployed | OA-owned per-conversation central LINE evidence archive; tenant business sources retained | Real PostgreSQL, source isolation, full text, Drive-only binaries, retry recovery and signed webhook checks | Production main f1f68d5 verified live on 2026-10-07 with capture enabled, verified legacy file references and bounded batches. Historical availability and completion are tracked in the target-local owner archive. |
| AM-IMP-2026.1004.07 | Deployed | Retrieve archived LINE attachments | Exact quote or complete filename in the same conversation; verified Drive link | Main e92dc4c live; retrieval contract and tenant archive readiness verified; real LINE delivery remains user acceptance. |
| AM-IMP-2026.1004.06 | Deployed | Drive originals; Notion links only | Production schema, runtime, exact 40 MB canary and completed available-source migration | Code 129dc97 verified; 1849 saved indexes with digests, 0 Notion binary references, 3 historical sources need re-upload. |
| AM-IMP-2026.1004.04 | Deployed | Durable attachment preservation | Group/room originals, retries, verified Drive storage and failure notices | Main commit b99dd8c, live ready health and independent 40,647,423-byte tenant storage canary verified; SHA256/MD5 match. Provider redelivery setting awaits login. |
| AM-IMP-2026.0718.01 | Deployed | Shadow operational memory | Notion/Drive identity, PostgreSQL migration, runtime-role separation, forced RLS isolation, Render deployment and public health | Forest uses the shared production PostgreSQL service with a dedicated restricted runtime role. Forest can access only its own tenant row; missing tenant context and a different tenant ID are denied. |

## Tenant boundary

- Tenant key: `forest`
- Tenant UUID: `aac8949f-0625-44d6-b655-57162f97143d`
- Data stays in Forest's own Notion parent, Drive root, PostgreSQL tenant row, and LINE group bindings.
- Shadow mode may create only candidate operational-memory records. It must not create formal tasks or send external replies.

| AM-IMP-2026.1008.01 | Deployed | Quoted photo resend and signed original download | 32 retrieval/delivery, 42 retention/archive tests; 19 core checks; webhook and signature route checks | Production main b40cb41 and signed endpoint verified; actual LINE device display remains an acceptance check. |
| AM-IMP-2026.1008.02 | Deployed | Explicit quoted conversation-archive retrieval | 84 attachment/archive tests; server webhook/private pause checks; 19 core checks | Production main 4c0f048 and native recovery/download/delivery verified. Explicit manual archive requests are independent of project activation; source/member gates remain required. |

| AM-IMP-2026.1008.03 | Deployed | MIME-aware video/audio download filenames | 88 attachment/archive tests, server webhook, 19 core checks | Production main f8b9e7b, old-link MIME/extension and original byte equality verified. Existing valid links retain exact original bytes and receive correct extensions. |

