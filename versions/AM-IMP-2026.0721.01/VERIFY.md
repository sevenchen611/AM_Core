# Verify

## Package verification

Run in AMCore:

```text
node tools/check-upgrade-package.js AM-IMP-2026.0721.01
node tools/audit-alignment.js
```

## Current implementation verification

Run in the target-equivalent runtime:

```text
node --check modules/meetings/policy.js
node --check modules/meetings/admin.js
node --check modules/meetings/index.js
node tools/verify-meeting-rollout-policy.mjs
node tools/verify-meeting-admin.mjs
```

The tests must prove:

1. The only canonical values are `off`, `record_only`, `review_only`, and
   `review_and_create`, with labels 關閉／僅記錄／確認試行／完整確認.
2. A legacy group without an explicit mode preserves existing behavior from
   `formalTasksEnabled`.
3. `formalTasksEnabled=false` clamps `review_and_create` to `review_only`, while
   `true` permits it.
4. Disabled/non-meeting bindings fail closed and shadow bindings are limited to
   `record_only`.
5. The admin schema initializer adds missing management fields/options,
   preserves existing options, and rejects incompatible field types.
6. Tenant source validation rejects a mismatched Group Bindings source.
7. A signed-in user lists only tenant-authorized rows; only a tenant-wide group
   manager can initialize schema or apply modes.
8. Browser page IDs cannot select an unauthorized row, and browser payloads
   cannot supply the LINE group ID used for cache invalidation.
9. Preflight is mode-aware and produces Ready, Warning, or Blocked with safe
   explanations.
10. A batch with any Blocked group is rejected before updates begin; up to 100
    unique selected rows are accepted.
11. A successful update stores mode, capability, Preflight metadata, version,
    last check time, and standard last setter/time fields.
12. The router invalidates the updated server-read group ID so new intake sees
    the setting without redeployment.
13. `review_only` never creates formal tasks, while `review_and_create` reaches
    existing formal-task creation only after confirmation.
14. Tenant data, member identities, meetings, tasks, and secrets never cross
    target or tenant boundaries.

## Portal smoke test

1. Sign in and open `會議功能管理臺`.
2. Switch tenant tabs and confirm only authorized groups for that tenant appear.
3. If fields are missing, use `初始化管理欄位` as a tenant-wide manager and
   confirm only the documented fields/options are added.
4. Select test groups, choose a batch mode, and run Preflight.
5. Confirm each row shows requested/effective mode and actionable issues.
6. Attempt to apply a batch containing a Blocked row and confirm no setting is
   changed.
7. Apply a Ready/Warning batch and confirm the Group Bindings rows contain the
   selected mode plus setter/time/version/Preflight metadata.
8. Confirm the next authorized meeting in an updated group uses the new mode
   without a Render redeploy, while an unselected group is unchanged.
9. Confirm a non-tenant-wide user cannot initialize fields or apply settings.
10. Confirm UI and API responses expose no credentials or secrets.

## Four-mode production smoke test

Use only authorized non-sensitive test groups and media:

- 關閉: new media does not start the meeting workflow.
- 僅記錄: meeting record completes without opening review.
- 確認試行: owner/host review completes without creating formal tasks.
- 完整確認: confirmed formal tasks are created once with meeting evidence.

Mark the target `Deployed` only after the applicable target-local tests pass.
Editable tenant policies, append-only audit, emergency controls, rollback
history, optimistic revision, and automatic provisioning are not verification
requirements for this version.
