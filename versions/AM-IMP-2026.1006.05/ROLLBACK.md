# Rollback

Restore the previous default menu ID from the outside-repository receipt with `POST /v2/bot/user/all/richmenu/{richMenuId}` and verify it. The prior menu is retained.

To recreate the previous layout if necessary:

```text
node tools/apply-compact-rich-menu.mjs --config versions/AM-IMP-2026.1006.04/config/work-journal-uof-rich-menu.json --image assets/line/work-journal-uof-rich-menu.png
```

Use the same guarded apply options and save a new outside-repository receipt for actual application. No runtime or data rollback is required.
