# Verify — AM-IMP-2026.0828.04

Run locally:

```text
node --check core/drive.js
node tools/dryrun-drive-privacy-audit.mjs
node tools/dryrun-engineering-contract-files.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0828.04
node tools/audit-alignment.js
```

Production verification:

1. Open Engineering AM → 合約範本版本庫.
2. Upload a private DOCX contract body.
3. The upload state shows the filename and SHA-256 prefix instead of HTTP 400.
4. Save V1 and confirm it appears in the version table.
5. Confirm the Drive folder and uploaded file have no `anyone` or `domain`
   permission.
6. Confirm no other tenant's Drive root or contract records changed.
