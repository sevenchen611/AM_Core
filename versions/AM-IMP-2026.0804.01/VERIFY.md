# Verify - AM-IMP-2026.0804.01

## Static and dry-run checks

```text
node --check core/group-binding-schema.js
node --check core/tenants.js
node --check modules/groups/index.js
node tools/dryrun-groups.mjs
node tools/dryrun-claims-governance.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0804.01
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

## Required behavior

1. The schema exposes `請款` and both claim-submitter fields.
2. A tenant without the `claims` module is not blocked by the two additive claims fields.
3. A tenant with the `claims` module is blocked from editing until both claim fields exist.
4. A tenant-all administrator can save an allowed sender only when the ID belongs to that binding's own member map.
5. An unknown, stale, or browser-supplied LINE user ID is rejected and produces no Notion PATCH.
6. A non-tenant-all administrator cannot alter `請款` capability, group status, claim submission policy, or claim submitter IDs.
7. HOZO AM 2.0 resolves all four claims environment variables at runtime, while `enabled` remains false until an explicit configuration change.
8. A group display-name change does not change the stored claim submitter IDs.

## Target-environment smoke test

Perform this only after the claims and Rental implementations are available:

1. Keep `claims.enabled=false`; send the claim command and verify no claim is created.
2. Enable the tenant flag but leave the group capability absent; verify fail-closed behavior.
3. Add capability but leave the binding inactive; verify fail-closed behavior.
4. Activate the binding and select one member; verify that member can receive a LIFF entry link and an unselected member cannot.
5. Confirm the Rental callback uses the binding page ID internally and that the group display name is not used as routing authority.
