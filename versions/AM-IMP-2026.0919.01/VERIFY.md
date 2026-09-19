# Verify

Run:

```text
npm run dryrun:contract-project-drawings
node tools/dryrun-construction-drawings.mjs
node tools/dryrun-engineering-contract-workspace.mjs
node tools/dryrun-engineering-contract-workflow-api.mjs
node tools/dryrun-engineering-contract-management.mjs
node tools/dryrun-engineering-contract-files.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0919.01
npm run check
```

Confirm:

- candidate listing is denied before Notion/Drive access when tenant or project scope is invalid;
- a deliberately over-broad drawing-index response is locally filtered to the contract project;
- browser responses omit Drive IDs and direct links;
- only supported, non-void, private files within 25 MB can be selected;
- save resolves selection IDs on the server and snapshots file metadata, hash, project, Phase 1 stage and drawing version;
- the original Drive file ID is referenced without a physical copy;
- a later drawing-library rename cannot alter the saved contract-version snapshot;
- carried documents display their Phase 1 source and can still be removed only through a new version;
- direct upload remains visible and operational;
- production smoke testing is read-only and performs no contract transition or LINE send.
