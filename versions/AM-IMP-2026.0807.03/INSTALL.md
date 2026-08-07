# Install

1. Deploy the runtime changes in `modules/calendar` and `modules/personal-assistant`.
2. If the live Rich Menu already sends the message texts in
   `config/hozo-rich-menu-actions-v1.json`, no LINE API change is required.
3. If the live Rich Menu action texts differ, run the apply script from the
   project environment that has `LINE_CHANNEL_ACCESS_TOKEN`:

```bash
node versions/AM-IMP-2026.0807.03/scripts/apply-rich-menu-actions.mjs \
  versions/AM-IMP-2026.0807.03/config/hozo-rich-menu-actions-v1.json \
  --image assets/hozo/ye-xiaowo-rich-menu-v1.png \
  --apply
```

The script creates a new Rich Menu, uploads the supplied image, and sets it as
the default menu. It does not delete old Rich Menus.

