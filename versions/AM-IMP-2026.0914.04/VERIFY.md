# Verify

```text
node --check modules/collect/index.js
node tools/dryrun-collect-attachment-archive.mjs
node tools/dryrun-core.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0914.04
node tools/audit-alignment.js
```

The dry run proves DWG and videos stream to Drive, supported PDFs retain Drive
and Notion copies, direct chats do not activate the group policy, files over 20
MiB skip Notion direct upload, and the existing sticker evidence behavior remains
unchanged. Production verification must additionally prove that Drive files open
and trace to the correct Engineering AM message, project, and group.
