# Verify

1. Run `node tools/dryrun-groups.mjs`.
2. Run `node --check core/line.js`, `node --check core/bootstrap.js`, and `node --check modules/groups/index.js`.
3. In a tenant group page, refresh one group and verify the dropdown contains only that group's members.
4. Save one owner and two reminder targets; confirm the binding page changes only in that tenant's Notion data source.
5. From Portal, open the tenant card with an account that has `am-<tenant>` and verify it reaches the AM backend without a second password prompt.
