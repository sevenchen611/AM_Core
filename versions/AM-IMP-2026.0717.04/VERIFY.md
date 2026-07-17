# Verify — AM-IMP-2026.0717.04

## Static and dry-run checks

From AMCore:

```text
node --check core/access.js
node --check core/portal.js
node --check core/modules.js
node --check server.js
node --check modules/groups/index.js
node --check modules/queue/index.js
node --check modules/tasks/index.js
node --check modules/construction/index.js
node --check modules/construction/tickets.js
node tools/dryrun-group-authorization.mjs
node tools/dryrun-portal-access.mjs
node tools/dryrun-access-directory.mjs
node tools/dryrun-groups.mjs
node tools/dryrun-queue-hooks.mjs
node tools/dryrun-tasks.mjs
node tools/dryrun-construction.mjs
node tools/audit-module-authorization.mjs
node tools/verify-portal-group-authz.mjs <portal-project-path>
node tools/check-upgrade-package.js AM-IMP-2026.0717.04
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

Also run `node --check _worker.js` inside the Portal repository.

## Shadow report checks

- Existing legacy users continue through shadow fallback, and Core logs the fallback tenant/user.
- New accounts start with `amAccess={}` and no AM/Rental/project checkbox is selected unless the role itself requires it.
- The review-only migration output does not write Portal or Notion.
- Every account intended for enforce mode has a highest-owner-confirmed `amAccess` entry.

## Required behavior

1. Forest user A selected only for group A sees only group A in groups, queue, tasks, and group-owned tickets.
2. Direct requests containing group B message page ID, attachment page ID, task ID, or ticket ID return 403/404 and produce zero Notion PATCH calls.
3. Batch confirmation query includes only authorized group relations; application-layer filtering rejects an unexpected cross-group result.
4. Tenant-all sees all four groups plus unassigned data; a fifth active group becomes visible without editing the account.
5. Selected users do not gain the fifth group.
6. A disabled group immediately disappears for selected users; tenant-all can still manage it in the disabled-groups view.
7. Master-group-only permission does not expose other groups.
8. Revoking the tenant/group or disabling the account changes the next Core request because Portal verifies the opaque session live.
9. Tenant A cannot read/write tenant B even with modified tenant/group/page IDs.
10. `/health` reports `groupAuthorization.mode`, Portal service configuration, and emergency-PIN state without exposing secret values.

Do not mark this package Deployed until each target project's production service has been independently verified.
