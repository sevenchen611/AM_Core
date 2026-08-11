# Verify AM-IMP-2026.0811.03

Run from the AMCore or installed AM Platform root:

```powershell
node --check modules/construction/dashboard.js
node tools/dryrun-construction-dashboard-management.mjs
node tools/dryrun-task-card.mjs
node tools/dryrun-construction.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0811.03
node tools/compare-project-manifests.js
node tools/audit-alignment.js
```

After deployment:

1. Confirm each visible project card shows `Notion ↗` after its name and chips.
2. Confirm each link URL matches that project's Notion page.
3. Open a link and confirm it uses a new tab.
4. Confirm opening the link does not change the selected dashboard project.
5. Confirm the dashboard health endpoint remains successful.
