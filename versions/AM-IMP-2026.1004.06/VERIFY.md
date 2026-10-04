# Verify

- node --test tools/test-attachment-retention.mjs tools/test-line-io.mjs
- node --experimental-vm-modules tools/verify-attachment-webhook.mjs
- node tools/dryrun-collect-attachment-archive.mjs
- node tools/dryrun-core.mjs
- node tools/dryrun-personal-line-routing.mjs
- node tools/dryrun-meetings.mjs
- node tools/check-upgrade-package.js AM-IMP-2026.1004.06
- node tools/audit-alignment.js (report unrelated unavailable standalone project paths without asserting complete alignment)

Production: health contract drive-only-line-attachments-v2, storage google-drive, notionFiles links-only; all active tenants ready. Verify each root independently. Existing production 40,647,423-byte synthetic PDF storage canaries cover each tenant, not a real LINE upload. Confirm new saved rows contain Drive links, exact bytes and MD5/SHA256 and an empty Notion files property. Count remaining managed files and migration failures tenant by tenant until available-source migration finishes; distinguish expired historical gaps. Do not send unsolicited test messages or copy real originals between tenants.
