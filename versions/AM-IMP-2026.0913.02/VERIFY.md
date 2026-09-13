# Verify

AMCore:

```text
node --check core/claims-authority-admin.js
node --check modules/claims/index.js
node --check modules/claims/authority-integration.js
node tools/dryrun-claims-authority-admin.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0913.02
```

HOZO Rental:

```text
node scripts/finance-claims-v3-web-ui.test.mjs
node scripts/check-admin-usage-counter.mjs
```

Confirm manually that each card opens the correct user-facing layout, carries a visible
administrator-preview notice, and cannot save, upload, or submit.
