# Verify

```text
node --check tools/apply-compact-rich-menu.mjs
node tools/apply-compact-rich-menu.mjs --journal-url <confirmed-HTTPS-URL>
node tools/check-upgrade-package.js AM-IMP-2026.1006.06
```

Inspect the active half-height PNG for readable labels and no clipping. Confirm the public URL loads, PNG dimensions are 2500 × 422, and the left URI/right message click bounds exactly cover their own halves. Missing journal URL must fail without applying. Old inactive configurations should still dry-run with explicit config/image paths.

Before Deployed, read back the actual default, exact journal URI, UOF command, dimensions and uploaded image SHA-256. Do not send unsolicited chat messages or approval requests during verification.
