# Verify AM-IMP-2026.0811.01

Run from the AMCore or installed AM Platform root:

```powershell
node --check modules/construction/master-data.js
node --check modules/construction/dashboard.js
node tools/dryrun-construction-dashboard-management.mjs
node tools/dryrun-task-card.mjs
node tools/dryrun-construction.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0811.01
node tools/compare-project-manifests.js
node tools/audit-alignment.js
```

After deployment, verify with a non-production test project or owner-approved
test records:

1. Every visible engineering project shows `新增空間`, `新增工種`, and `新增工項`.
2. Create one space and confirm its Notion `專案` relation points to the selected
   project.
3. Create one trade and confirm it appears in other projects under the same
   engineering tenant.
4. Create one work item with planned start and end dates.
5. Confirm the new item appears in the Gantt chart and space-by-trade matrix.
6. Confirm a user limited to another project code cannot write to the test
   project.
7. Remove or clearly mark temporary verification records in the project-local
   Notion workspace after proof is captured.
