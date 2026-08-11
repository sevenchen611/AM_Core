# Verify AM-IMP-2026.0811.02

Run from the AMCore or installed AM Platform root:

```powershell
node --check modules/construction/master-data.js
node --check modules/construction/dashboard.js
node tools/dryrun-construction-dashboard-management.mjs
node tools/dryrun-task-card.mjs
node tools/dryrun-construction.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0811.02
node tools/compare-project-manifests.js
node tools/audit-alignment.js
```

After deployment, verify with an owner-approved test record:

1. Open `新增工項` and confirm multiple space checkboxes are visible.
2. Confirm `全選所有空間` and `清除選取` work.
3. Select at least two spaces and create one work item.
4. Confirm Notion contains one Work Item per selected space.
5. Submit the same form again and confirm those spaces are skipped.
6. Confirm the Gantt labels include each related space and the space-by-trade
   matrix refreshes correctly.
7. Confirm a mixed selection containing an out-of-project space is rejected
   before any new Work Item is written.
