# Verify

## AMCore

```text
node tools\check-upgrade-package.js AM-IMP-2026.0608.19
node tools\compare-project-manifests.js
node tools\audit-alignment.js
```

## Project-Local Notion

Confirm these items:

- The total-control task `Default view` table does not display `來源原文`.
- Any task review table that previously displayed `來源原文` no longer displays it.
- The `來源原文` property still exists in the database schema.
- Existing task page body evidence remains available.
