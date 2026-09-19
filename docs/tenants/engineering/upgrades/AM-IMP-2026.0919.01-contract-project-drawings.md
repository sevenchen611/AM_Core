# AM-IMP-2026.0919.01 — Contract project drawings

Status: Installed; production deployment pending.

The Engineering contract V1/next-version editor now offers `從工程圖庫選擇`. It derives the project from the authorized contract, lists only that project's Phase 1 drawing versions, shows safe preview metadata, and supports multiple selections. Existing direct file upload is unchanged.

Selections are opaque version IDs. The server re-resolves each ID, checks tenant/project scope before reading the drawing index, rejects foreign/void/unsupported/oversized/non-private files, downloads the private source within 25 MB and records SHA-256. The saved contract version references the original Drive file and snapshots source project, Phase 1 stage, drawing name/version/status, original filename, upload evidence, MIME type, size and hash. Later source renames do not rewrite the version. No physical copy or source deletion occurs.

No production data, schema or environment migration is required. Deployment verification must remain read-only: open the picker and inspect candidates, but do not save a contract version, freeze, issue, sign or send LINE.
