# Verify

Inspect `assets/line/work-journal-uof-rich-menu.png`: two tiles only, readable Traditional Chinese labels, muted journal tile with 暫未開放, active UOF tile and no empty third area.

```text
node --check tools/apply-compact-rich-menu.mjs
node tools/apply-compact-rich-menu.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1006.04
```

The script checks 2500 × 843 image dimensions, file size, exactly one right-side message action (待簽), confirmed channel identity and LINE API validation. There is no left-side click area and no URI action. Live application checks the current default ID and exact action array. Production receipts remain outside AMCore. End-user delivery of the existing UOF command is not triggered by the application script.

Official LINE reference: https://developers.line.biz/en/reference/messaging-api/#rich-menu
