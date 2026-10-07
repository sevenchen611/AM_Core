# AM-IMP-2026.1008.01: green-hotel

Status: Deployed.

This Platform tenant uses the shared reviewed core delivery service on its own existing message/attachment sources. Exact quoted originals and same-conversation filename lookup preserve tenant/private sender routing, central archive references, retained state, size and MD5 gates. JPEG/PNG up to 10 MB returns a photo plus a two-hour signed original download; other files retain a download. Drive permissions are unchanged. Requests remain general conversation, not tasks.

Local verification: 32 retrieval/delivery tests, 42 retention/central archive tests, core 19 checks, collect contract and real-server webhook/signature routing passed. Production runtime deployed; recipient LINE device display remains an explicit acceptance check. No customer contents, source identifiers, signing tokens or credentials are recorded here.

Verified at: 2026-10-08T07:56:26.1844319+08:00. Reviewed PR #264; production main b40cb41763479d66817e70a74e7b2f12e8667fbf. Health delivery contract line-quoted-image-signed-download-v1, TTL 7200 and invalid-token HTTP 403 verified. Runtime and signing configuration are live. Bounded existing-source reads returned HTTP 403; a read-only diagnosis confirmed all eight recent samples belong to shadow-record groups. This is the existing activation gate, not a failed deployment. End-user retrieval requires an active group; no binding was activated. No permission, binding, file or source record was changed.
