# Install

Use a reviewed commit merged to and pushed on main. Confirm the target bot against its previous outside-repository receipt, retrieve its active default and exact journal URI, inspect aliases and determine any per-user menu scope. Preserve previous associations in the target's private recovery receipt. This installer changes the default only; per-user menu changes require explicit targeted handling.

Run first without `--apply`:

```text
node tools/apply-compact-rich-menu.mjs --config versions/AM-IMP-2026.1007.01/config/work-journal-uof-rich-menu.json --image assets/line/work-journal-uof-rich-menu-external-browser-half-height.png --journal-url <confirmed-direct-HTTPS-URL> --journal-origin <confirmed-HTTPS-origin>
```

For confirmed harmless query parameters, specify their names with `--journal-query-keys view,tab`. Sensitive identity/authentication query keys cannot be allowlisted. The placeholder always selects external-browser mode. Existing packages keep their original behavior; `--external-browser` is available for explicit opt-in.

For the authorized target, load its own `LINE_CHANNEL_ACCESS_TOKEN` without displaying it, then add `--apply --expected-bot <prior-confirmed-basic-ID> --expected-default <preflight-default-ID> --receipt <new-outside-repository-path>`. The receipt is reserved before LINE mutations, old default retained, uploaded PNG/URI/areas/size read back. If anything fails after creating the new menu, use the saved receipt to reconcile/restore. Do not blindly rerun after an unknown result.

No journal data, database, webhook, identity binding, scheduling or application environment change is required. Update this target's manifest/upgrade record only after the corresponding local/production checks pass.
