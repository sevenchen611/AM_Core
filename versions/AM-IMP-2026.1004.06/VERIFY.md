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

## Production verification, 2026-10-04

Reviewed main runtime commit 129dc97cf297fb3b8b11b92de43893987e7f35dc is live. All four active tenants have ready schema/health, google-drive storage and links-only Notion policy. Completed managed-original migrations: 2,936 (includes four synthetic verification files). Seventeen historical originals lacking backups were recovered from exact available LINE sources. Two pre-existing Drive-only indexes were independently verified and completed. Total saved Drive indexes with recorded SHA256/MD5: 2,955. Remaining Notion binary references, pending/retry jobs and transfer failures: 0. Twenty-six historical sources remain unavailable and are explicitly flagged for re-upload; two require source-context review as well.

The provider redelivery toggle still needs management-console login verification. No claim of real LINE large-file canary or complete standalone-project alignment is made. Local/CI transfer, isolation, restart, source checksum and viewer-URL regression checks pass.
