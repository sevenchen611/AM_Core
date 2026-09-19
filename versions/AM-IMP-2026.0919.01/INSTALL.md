# Install

1. Merge the reviewed package into AM Platform `main`.
2. Confirm the Engineering tenant already has its `designDrawings` data source and private Drive integration.
3. Run `npm ci` and `npm run dryrun:contract-project-drawings`.
4. Run the contract workspace, workflow API, management, file and drawing-library regressions listed in `VERIFY.md`.
5. Deploy the reviewed `main` commit through the existing Render service. No database migration or environment change is needed.
6. Verify `/health`, then use an authenticated Engineering contract workspace to open the picker read-only. Do not save, freeze, issue, sign or send LINE during deployment smoke verification.
