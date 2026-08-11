# Roll Back AM-IMP-2026.0811.01

1. Restore the previous AM Platform versions of:
   - `modules/construction/dashboard.js`
   - `modules/construction/README.md`
2. Remove `modules/construction/master-data.js` and
   `tools/dryrun-construction-dashboard-management.mjs` only from the installed
   runtime version being rolled back.
3. Redeploy the affected AM Platform service from its own project folder.
4. Verify the dashboard remains read-only and existing Gantt, matrix, SOP,
   ticket, meeting, task, and photo views still load.

Rollback removes the creation UI and API routes. It does not delete Spaces,
Trades, or Work Items already created in the project-local Notion workspace.
Those records remain recoverable and auditable in Notion.
