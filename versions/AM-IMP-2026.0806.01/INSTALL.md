# Install

1. Add `modules/construction/task-card.js` to the AM Platform runtime.
2. Register `/task` in the construction module with `construction.read` access.
3. Inject `uploadFileToNotion` into construction request dependencies.
4. Change construction-tenant reminder links to `/task?tenant=<key>&doc=<page>`.
5. Keep `/dashboard` unchanged for project-level control and as the task card's secondary link.
6. Run `npm run dryrun:task-card` before deployment.

No Notion schema or environment-variable migration is required.
