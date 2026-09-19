# AM-IMP-2026.0919.01 — Contract project drawings

Status: Deployed.

The Engineering contract V1/next-version editor now offers `從工程圖庫選擇`. It derives the project from the authorized contract, lists only that project's Phase 1 drawing versions, shows safe preview metadata, and supports multiple selections. Existing direct file upload is unchanged.

Selections are opaque version IDs. The server re-resolves each ID, checks tenant/project scope before reading the drawing index, rejects foreign/void/unsupported/oversized/non-private files, downloads the private source within 25 MB and records SHA-256. The saved contract version references the original Drive file and snapshots source project, Phase 1 stage, drawing name/version/status, original filename, upload evidence, MIME type, size and hash. Later source renames do not rewrite the version. No physical copy or source deletion occurs.

No production data, schema or environment migration was required.

## Production verification

- PR #188 was merged as `a6e25325e6a4c96b563b60be672b4b281d8c94fc`.
- Render deploy `dep-damtinrtqb8s73a2k3v0` reached Live; production health returned HTTP 200 and reported that exact commit.
- Authenticated read-only verification opened `草悟道館` / `HZ-CT-002` / `建立 V3` and loaded eight same-project Phase 1 drawing candidates. The picker showed file name, version, finalization status, upload time and uploader.
- Every candidate remained unchecked and the V3 composer was cancelled. No contract version was saved, and no freeze, issue, signature, confirmation or LINE action was performed.
