# AM-IMP-2026.1008.02: engineering

Status: Deployed.

The shared Platform core now reserves genuine self-mention plus quoted-file requests for a source-only owner-archive operation when the conversation is unbound or shadow-record. Current OA, registered conversation, current member, original-file identity and signed-download fingerprint checks are required. This does not enable general project replies, task creation, or private assistant access. Explicitly inactive/ambiguous/failed tenant routes and transport ownership remain closed.

Missing originals can be queued for LINE content recovery only using the persisted real request as quote evidence. Recovery records state that original sender/time are unknown; no customer data, source identifiers or secrets are stored in this shared record.

Verification: 84 attachment/retrieval/retention/archive tests; real server webhook and private pause; 9 calendar regression tests; 19 core checks. Package check passed. Whole legacy alignment audit retains existing missing standalone manifest/local-path gaps; no whole-project alignment completion is claimed.

Verified at: 2026-10-08T09:42:45.4448014+08:00. Reviewed PR #266; actual production main 4c0f048b4de5063fbfc6cc9452127078f003b9cc. Health quotedArchive contract verified. Native recovery from a persisted real request produced the exact source's Drive original. Original/image/preview returned HTTP 200; MD5, full image equality and bounded JPEG preview verified. Explicitly requested same-group photo plus original download were accepted by LINE HTTP 200, with two durable accepted records. No recipient device observation is claimed. Live source evidence remains production-local. This tenant shares the verified Platform core; no tenant-specific data or binding was changed.

