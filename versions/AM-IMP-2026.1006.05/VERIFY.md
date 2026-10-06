# Verify

```text
node --check tools/apply-compact-rich-menu.mjs
node tools/apply-compact-rich-menu.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1006.05
```

Inspect the half-height PNG at actual mobile scale: readable labels, no clipping, side-by-side icons and text. Confirm dimensions 2500 × 422 and file size below 1 MB. Only the right half is tappable; message text is 待簽. LINE validation and default/action readback must pass. Retrieve the uploaded image and compare SHA-256 with the local PNG before marking Deployed.
