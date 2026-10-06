# Install

Confirm the work journal's actual HTTPS URL is usable on a phone before applying. A local-only address cannot be used.

```text
node tools/apply-compact-rich-menu.mjs --journal-url <HTTPS_URL>
node --env-file=<project-local-env> tools/apply-compact-rich-menu.mjs --journal-url <HTTPS_URL> --expected-bot <verified-basic-id> --receipt <outside-AMCore-receipt.json> --apply
```

The script verifies the channel identity, journal HTTP response, LINE object validation and image dimensions before creating a menu. It uploads the image before switching the default and verifies the result. Keep the former menu for rollback. Do not link user-specific menus automatically or change runtime enablement. Existing per-user menus may retain priority over the account default.
