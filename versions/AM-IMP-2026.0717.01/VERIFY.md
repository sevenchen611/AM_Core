# Verify

## Local

```text
node --check server.js
node --check core/tenants.js
node --check core/portal.js
node --check modules/construction/tickets.js
npm run dryrun:engineering
node tools/dryrun-core.mjs
node tools/dryrun-construction.mjs
node tools/dryrun-media.mjs
node tools/dryrun-triage.mjs
node tools/dryrun-reminders.mjs
node tools/dryrun-meetings.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0717.01
```

## Production gate

- `/health` reports engineering with all eight requested modules loaded.
- LINE signature verification succeeds on the platform endpoint.
- One engineering bound group writes only to engineering Notion sources.
- One forest bound group writes only to forest Notion sources.
- `/dashboard`, `/queue`, `/tickets`, `/budget`, `/contracts` work with the engineering tenant.
- Existing legacy Portal authorization opens engineering only and cannot open another tenant.
- Text triage, image association, meeting audio and reminders each pass one real bound-group test.

Do not mark this package `Deployed` until the LINE webhook points at AM Platform and the production gate passes.
