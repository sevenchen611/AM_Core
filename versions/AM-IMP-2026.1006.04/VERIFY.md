# Verify

Inspect `assets/line/work-journal-uof-rich-menu.png`: two buttons only, readable Traditional Chinese labels, matching icons and no empty third area.

```text
node --check tools/apply-compact-rich-menu.mjs
node tools/apply-compact-rich-menu.mjs --journal-url https://example.com/work-journal
node tools/check-upgrade-package.js AM-IMP-2026.1006.04
```

The example URL is dry-run only and cannot be applied. The script checks 2500 × 843 image dimensions, file size, exactly two bounded click areas, confirmed channel identity and LINE API validation. Live application additionally checks the current default ID and both actions. No production application has occurred while the journal URL is missing.

Official LINE reference: https://developers.line.biz/en/reference/messaging-api/#rich-menu
