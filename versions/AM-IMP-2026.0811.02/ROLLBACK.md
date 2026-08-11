# Roll Back AM-IMP-2026.0811.02

1. Restore the `AM-IMP-2026.0811.01` versions of:
   - `modules/construction/dashboard.js`
   - `modules/construction/master-data.js`
   - `modules/construction/README.md`
   - `tools/dryrun-construction-dashboard-management.mjs`
2. Redeploy the AM Platform service.
3. Verify single-space Work Item creation still works.

Rollback removes multi-space selection only. It does not delete any Work Items
already created in tenant-local Notion databases.
