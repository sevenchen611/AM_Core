# Verify

## Local

```text
node --check modules/construction/dashboard.js
node tools/dryrun-construction-drawings.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0915.01
node tools/audit-alignment.js
```

The drawing dry run must assert that the generic management API call is guarded
from the drawing branch.

## Production

1. Confirm the deployed Render commit contains the guard.
2. Confirm `/health` returns HTTP 200 with Engineering Notion and Drive ready.
3. Confirm the existing uploaded drawing version is visible after reloading the
   project.
4. For the next authorized real upload, confirm a success alert is shown and the
   project refreshes without the `undefined.includes` error.

Production verification must not create a test drawing or delete existing
evidence.
