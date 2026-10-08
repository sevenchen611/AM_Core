# VERIFY

- node --test tools/test-attachment-retrieval.mjs tools/test-attachment-delivery.mjs tools/test-central-archive.mjs tools/test-attachment-retention.mjs (84 passing tests)
- node --experimental-vm-modules tools/verify-attachment-webhook.mjs
- node --experimental-vm-modules tools/verify-private-assistant-pause.mjs
- node --experimental-vm-modules --test tools/test-leaf-calendar.mjs
- node tools/dryrun-core.mjs
- node tools/check-upgrade-package.js AM-IMP-2026.1008.02
- node tools/audit-alignment.js and node tools/compare-project-manifests.js; report pre-existing legacy-path gaps separately.
- Verify deployed main commit, /health attachmentRetrieval.quotedArchive = line-explicit-quoted-conversation-archive-v1, invalid signed links denied, source-scoped original/image/preview integrity.
- Verify explicit real mention/quote on an unbound or shadow group can retrieve its original; no mention, inactive/ambiguous/failed routes, foreign OA/source/private sender or revoked membership cannot expose originals.
- Verify quote-only recovery retains raw request evidence; unavailable LINE originals yield needs_source. Do not invent original sender/date. Keep all live verification records and sensitive source identifiers outside shared AMCore.
