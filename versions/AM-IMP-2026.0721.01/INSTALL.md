# Install

Install this version separately in every target. AMCore is the shared package
source; it is not the production Portal or LINE runtime.

## 1. Prerequisites

1. Confirm `AM-IMP-2026.0720.01` and `AM-IMP-2026.0720.03`, or equivalent
   behavior, are installed in the target.
2. Confirm the target already has Portal authentication, tenant routing, Group
   Bindings, meetings, and the required project-local external configuration.
3. Preserve unrelated changes and do not copy any target's data or secrets.

## 2. Install the canonical runtime behavior

Apply the target-equivalent changes for:

```text
core/group-binding-schema.js
core/router.js
modules/groups/index.js
modules/meetings/policy.js
modules/meetings/admin.js
modules/meetings/index.js
tools/verify-meeting-rollout-policy.mjs
tools/verify-meeting-admin.mjs
```

The installed policy must use the exact production enum and labels:

| Enum | Portal label |
| --- | --- |
| `off` | 關閉 |
| `record_only` | 僅記錄 |
| `review_only` | 確認試行 |
| `review_and_create` | 完整確認 |

Do not introduce editable tenant default/ceiling controls. In this version,
`formalTasksEnabled` is the compatibility ceiling: `true` allows
`review_and_create`; `false` allows at most `review_only`.

## 3. Add the Portal page

Add the `會議功能管理臺` entry to the authenticated Portal. Install:

- tenant tabs;
- tenant-scoped group listing and checkboxes;
- row mode selector and batch mode selector;
- selected-group Preflight and batch apply (maximum 100 groups);
- safe meeting-management schema initialization;
- requested/effective mode and Preflight status display.

Keep authorization server-side. Listing and Preflight use the target's existing
Portal access filter. Schema initialization and apply require the tenant-wide
group-manager permission and core group-edit permission.

## 4. Initialize the existing Group Bindings source

For each tenant, an authorized tenant-wide manager may press `初始化管理欄位`.
The initializer adds only missing meeting-management fields described in
`REQUIRED_DATABASES.md`, preserves existing select options, and refuses to
overwrite an incompatible existing field type.

This action does not create a Notion source or integration and does not
provision LIFF, LINE, Render, storage, transcription, or AI resources.

## 5. Preserve legacy behavior

Do not bulk-write a mode during installation. When a Group Bindings row has no
explicit meeting mode:

- tenant `formalTasksEnabled=true` keeps the existing complete review-and-create
  behavior;
- tenant `formalTasksEnabled=false` keeps the existing record-only behavior.

An administrator may later run Preflight and save explicit modes for selected
groups. Successful updates write the Group Bindings metadata and immediately
invalidate the server-read group ID in the router cache; no redeploy is needed
for that group setting.

## 6. Verify and record status

1. Run `VERIFY.md` in the target.
2. Create the target-local upgrade record and update its project manifest.
3. Deploy only from the target's own project/service.
4. Mark `Deployed` only after target-local production tests pass.

Do not add future-only audit databases, emergency controls, rollback history,
optimistic configuration revisions, tenant-policy editors, or automatic
provisioning as part of this version.
