# Verify

## Local

```text
node --check core/notion.js
node --check core/router.js
node --check modules/groups/index.js
node tools/dryrun-core.mjs
node tools/dryrun-groups.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0717.02
```

## Tenant acceptance

- `/admin?tenant=<key>` requires the target tenant's PIN or SSO authority.
- `/groups?tenant=<key>` lists only that tenant's group bindings.
- Saving purpose, owner and capabilities updates the correct row and takes effect on the next LINE event.
- An attempted page update using a page from another tenant is rejected by the Notion guard.
- Existing LINE routing remains unchanged for groups that are still `啟用`.
