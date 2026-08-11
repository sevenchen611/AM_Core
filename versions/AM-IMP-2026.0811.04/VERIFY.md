# Verify AM-IMP-2026.0811.04

Run from the AMCore or installed AM Platform root:

```powershell
node --check modules/construction/master-data.js
node --check modules/construction/dashboard.js
node tools/dryrun-construction-dashboard-management.mjs
node tools/dryrun-task-card.mjs
node tools/dryrun-construction.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0811.04
node tools/compare-project-manifests.js
node tools/audit-alignment.js
```

After deployment, use an owner-approved Work Item if testing a live write:

1. Click a Gantt Work Item title and confirm the edit modal opens.
2. Cancel, click its time bar, and confirm the same modal opens.
3. Confirm the current name, dates, status, space, and trade are shown.
4. Save an approved change and confirm the Notion page is patched.
5. Confirm the Gantt and matrix refresh immediately.
6. Confirm an out-of-project Work Item id is rejected before any write.
