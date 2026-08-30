# Verify

1. Run `npm run dryrun:contract-review`.
2. Run `node tools/check-upgrade-package.js AM-IMP-2026.0831.01`.
3. Run the Engineering contract workspace, management, and workflow API dry-runs.
4. Run `npm run check` and `git diff --check`.
5. Open the existing HZ-CT-001 V2 link and verify V1 feedback appears under `歷次審閱意見`.
6. Open the complete merged PDF and verify its final page contains the chronological review history.
