# VERIFY

- node --test tools/test-attachment-delivery.mjs tools/test-attachment-retrieval.mjs tools/test-central-archive.mjs tools/test-attachment-retention.mjs (88 passing tests)
- node --experimental-vm-modules tools/verify-attachment-webhook.mjs
- node tools/dryrun-core.mjs (19 checks)
- node tools/check-upgrade-package.js AM-IMP-2026.1008.03
- node tools/audit-alignment.js and node tools/compare-project-manifests.js; report existing legacy/local-path gaps separately.
- Verify actual production main commit and /health attachmentRetrieval.filename = verified-media-mime-filename-v1.
- With an existing unexpired signed URL to an extensionless verified video, require HTTP 200, Content-Type video/mp4, ASCII filename attachment.mp4, UTF-8 filename ending .mp4, unchanged size and persisted MD5. Confirm MP4 container and track metadata without storing customer bytes in this repository.
- Verify unknown formats are not invented; supplied extensions remain unchanged; changed metadata or revoked source/member cannot expose bytes.
