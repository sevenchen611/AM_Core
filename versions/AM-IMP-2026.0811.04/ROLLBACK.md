# Roll Back AM-IMP-2026.0811.04

1. Restore the previous versions of:
   - `modules/construction/dashboard.js`
   - `modules/construction/master-data.js`
   - `modules/construction/README.md`
   - `tools/dryrun-construction-dashboard-management.mjs`
2. Redeploy the AM Platform service.
3. Confirm the Gantt remains visible in read-only mode.

Rollback removes Gantt editing only. It does not reverse Work Item changes that
were already saved to tenant-local Notion pages.
