# Install

Review and merge the package/assets/apply-script changes to main before application. Run the script from that clean revision with the target project's local credential:

```text
node tools/apply-compact-rich-menu.mjs
node --env-file=<project-local-env> tools/apply-compact-rich-menu.mjs --expected-bot <verified-basic-id> --receipt <outside-AMCore-receipt.json> --apply
```

The default config/image now select the half-height version. The script validates the channel, size, right-side command and LINE object, then uploads before switching the default. No user-specific menu links or chat messages are created.
