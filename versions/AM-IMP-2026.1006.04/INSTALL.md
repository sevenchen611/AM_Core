# Install

The work journal is intentionally inactive; no URL is configured.

```text
node tools/apply-compact-rich-menu.mjs
node --env-file=<project-local-env> tools/apply-compact-rich-menu.mjs --expected-bot <verified-basic-id> --receipt <outside-AMCore-receipt.json> --apply
```

The script verifies the channel identity, LINE object validation and image dimensions before creating a menu. It uploads the image before switching the default and verifies the result and exact UOF action. Keep the former menu for rollback. Do not link user-specific menus automatically or change runtime enablement. Existing per-user menus may retain priority over the account default.
