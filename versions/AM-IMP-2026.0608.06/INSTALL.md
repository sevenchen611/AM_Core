# Install

1. Ensure the project has task and message data source IDs in its own `.env`.
2. Add or verify `/control/reports/preview`.
3. Add dynamic daily report generation to `src/control-api.js`.
4. Keep project-specific category rules local to each project.
5. Verify `scripts/render-cron-report.js` can call preview/send paths.
6. Update the project manifest and create the local upgrade record.

Do not copy message records, task records, report records, or database IDs between projects.

