# Roll Back AM-IMP-2026.0811.03

1. Restore the previous versions of:
   - `modules/construction/dashboard.js`
   - `modules/construction/README.md`
   - `tools/dryrun-construction-dashboard-management.mjs`
2. Redeploy the AM Platform service.
3. Confirm project cards and project detail loading still work.

Rollback removes only the dashboard links. It does not modify or delete any
Notion page.
