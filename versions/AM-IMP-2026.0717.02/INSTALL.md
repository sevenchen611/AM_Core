# Install

1. Deploy AM Platform source that includes the `groups` module.
2. Add `groups` to the target tenant's `modules` array. For a tenant that should land in this backend, set `config.homeRoute` to `/admin`.
3. With that tenant's own environment values loaded, preview its schema change:

```text
node --env-file=.env tools/apply-group-binding-v2-schema.mjs <tenant-key> --dry-run
```

4. Apply only that tenant's schema:

```text
node --env-file=.env tools/apply-group-binding-v2-schema.mjs <tenant-key>
```

5. Open `/groups?tenant=<tenant-key>` using that tenant's Portal PIN or SSO permission. Fill each active group before enabling automation that depends on the new values.

Do not copy a group row, LINE group ID, member map, owner or Notion ID from another tenant.
