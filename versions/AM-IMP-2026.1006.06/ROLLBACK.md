# Rollback

Restore the previous default ID from the outside-repository receipt using the target project's LINE credential, then verify the active menu. The previous half-height inactive menu is retained.

To recreate it if needed:

```text
node tools/apply-compact-rich-menu.mjs --config versions/AM-IMP-2026.1006.05/config/work-journal-uof-rich-menu.json --image assets/line/work-journal-uof-rich-menu-half-height.png
```

Use the guarded apply options and a new external receipt for actual application. No runtime or user-data rollback is required.
