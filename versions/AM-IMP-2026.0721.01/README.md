# AM-IMP-2026.0721.01 — AM Meeting Rollout Control Center / 會議功能管理台

Status: **Ready**

Depends on:

- `AM-IMP-2026.0720.01` — meeting todo confirmation gate
- `AM-IMP-2026.0720.03` — reliable LINE meeting-media intake and tenant-safe routing

This portable package defines a Portal administration page and runtime policy
for enabling the meeting-record workflow by tenant and LINE group. After the
one-time project setup is complete, an authenticated tenant-wide Portal group
manager can change a group's meeting mode without editing code or redeploying
the service.

The package is a shared control contract. Every target installs the behavior in
its own runtime and keeps its own settings, identities, records, credentials,
and deployment status.

## Four rollout modes

Modes are ordered from least to most capable:

| Mode | Portal label | Result |
| --- | --- | --- |
| `off` | 關閉 | Meeting media does not enter the meeting workflow. |
| `record_only` | 僅記錄 | Produce and publish the meeting record using the target's existing compatible flow; do not open the todo-review workflow. |
| `review_only` | 確認試行 | Produce the meeting record and editable candidate todos, run owner and host confirmation, but do not create formal tasks. |
| `review_and_create` | 完整確認 | Produce the meeting record, complete owner and host confirmation, and create formal tasks with meeting evidence. |

Changing a mode controls new meeting intake immediately after the group binding
is updated and that group ID's router cache is invalidated. An already-created
meeting/review session keeps the meeting mode stored when it started, so a later
setting change does not silently alter that session.

## Tenant ceiling and group setting

This version does not expose editable tenant defaults or ceilings in Portal.
The existing tenant setting `config.meetings.formalTasksEnabled` is the
compatibility ceiling:

- `true`: the highest allowed group mode is `review_and_create`;
- `false`: the highest allowed group mode is `review_only`.

Each bound group stores its requested mode in its own Group Bindings row. The
runtime clamps that request to the tenant ceiling. A disabled tenant or binding,
a group without the meetings capability, or an invalid policy fails closed to
`off`. A shadow binding is limited to `record_only`.

For a legacy group without a stored group mode, existing behavior is preserved:
`formalTasksEnabled=true` resolves to `review_and_create`, while `false`
resolves to `record_only`.

## Portal behavior

The management page provides tenant tabs and lists that tenant's project-local
bound LINE groups. It shows:

- selected/requested and effective meeting mode;
- when a legacy setting or tenant safety ceiling affects the result;
- group binding and member-sync health;
- LIFF, LINE, meeting source, task source, transcription, AI, and storage
  readiness as applicable to the selected mode;
- the stored preflight result, check time, meeting setting version, and the
  Group Bindings row's last setter/time fields when those standard fields exist.

The page supports group checkboxes, a batch mode selector, selected-group
Preflight, and batch apply (up to 100 groups). If any selected group is Blocked,
the batch is rejected before settings are changed. Successful changes update the
Group Bindings rows and take effect without a Render redeploy.

## Authorization and safety

- Portal access is tenant-scoped. An authenticated user may only see rows allowed
  by that tenant's Portal access filter.
- Only the tenant-wide group manager (`isTenantAll`) may initialize schema or
  batch-apply modes for that tenant.
- Authorization is enforced on every server endpoint; hiding controls in the
  browser is not sufficient.
- The group binding records the last setter, last setting time, meeting setting
  version, Preflight result, explanation, and last check time.
- The browser never receives LINE tokens, Notion tokens, signing secrets, or
  other credentials.

## One-time setup is outside the checkbox

Selecting a mode, running Preflight, or initializing management fields does
**not** create, publish, authorize, or repair:

- a LINE Login channel or LIFF app;
- LINE Messaging API credentials or group membership;
- Render services, environment secrets, storage, or databases;
- Notion integrations, pages, data sources, schemas, or permissions;
- transcription, AI, or media-storage accounts.

These project-local prerequisites are prepared once by an authorized operator.
The control center only verifies them and then enables an already-capable
workflow.

## Compatibility

Installation must not blanket-enable groups. A legacy group without a stored
mode continues to derive its behavior from the tenant's existing
`formalTasksEnabled` value. An administrator can then run Preflight and save an
explicit mode for selected groups.

Existing meeting records and formal tasks are not rewritten. The original
meeting-record path remains available through `record_only`, and the host's
compatible skip behavior remains governed by the installed confirmation-gate
version.

## Data boundary

AMCore contains only this reusable contract. Each installation keeps group
settings, LINE identities, member mappings, meeting records, candidate todos,
confirmations, formal tasks, credentials, and operational logs inside that
target. No live data or secret may be copied between AM Platform, HOZO AM,
SevenAM, or a new AM project.

## Later extensions (not included in this version)

The following are deliberately outside this version's completion criteria:

- editable tenant default/ceiling controls;
- an independent append-only configuration audit database;
- emergency-stop and pause-new-meetings controls;
- rollback-history UI;
- cross-page optimistic configuration revision checks;
- automatic provisioning of LIFF, Render, Notion, LINE, storage,
  transcription, or AI resources.
