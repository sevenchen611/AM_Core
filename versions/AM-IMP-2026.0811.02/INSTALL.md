# Install AM-IMP-2026.0811.02

1. Install dependency `AM-IMP-2026.0811.01` first.
2. Apply the shared changes to:
   - `modules/construction/dashboard.js`
   - `modules/construction/master-data.js`
   - `modules/construction/README.md`
   - `tools/dryrun-construction-dashboard-management.mjs`
3. Keep the existing tenant-local Projects, Spaces, and Work Items data-source
   configuration. This package adds no new database fields or secrets.
4. Run the commands in `VERIFY.md`.
5. Deploy only from the AM Platform production project.
