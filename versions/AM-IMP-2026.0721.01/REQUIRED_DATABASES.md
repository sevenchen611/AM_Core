# Required Data Sources

This version does not require a new independent audit or rollout database. It
extends each tenant's existing project-local Group Bindings source and continues
to use the meetings/review/tasks sources required by dependency versions.

No live data-source identifier belongs in this package.

## Existing Group Bindings core fields

The selected tenant source must already contain:

- `群組名稱`;
- `LINE 群組 ID`;
- `狀態`;
- `啟用功能`.

Standard Group Bindings schemas also contain `最後設定者` and `最後設定時間`.
When present, an apply operation updates both fields.

## Fields initialized by this version

| Field | Type and values | Purpose |
| --- | --- | --- |
| `會議待辦模式` | Select: 關閉／僅記錄／確認試行／完整確認 | Stores the group's requested mode. |
| `會議導入檢查` | Select: Ready／Warning／Blocked | Stores the latest apply-time Preflight result. |
| `會議檢查說明` | Rich text | Stores the safe operator-facing Preflight summary. |
| `會議設定版本` | Rich text | Stores the meeting-management schema/version marker. |
| `會議最後檢查時間` | Date | Stores the latest successful apply check time. |

The initializer adds missing fields and missing select options. It does not
replace an existing field with an incompatible type; that condition is blocked
for manual review.

## Runtime read/write rules

- Every data-source call uses the server-selected tenant key and that tenant's
  configured Group Bindings source.
- The source returned by Notion must match the configured tenant source before
  any write is accepted.
- Browser-submitted page IDs are matched only against rows visible through the
  current tenant's Portal access filter.
- The effective mode is computed on the server from the stored requested mode,
  binding state/capabilities, shadow restriction, and tenant
  `formalTasksEnabled` ceiling.
- LINE group IDs remain target-local and are read from authorized binding rows;
  they are never accepted from the apply payload.

## Existing meetings/review/tasks sources

- Every non-off mode requires the target's existing meeting-record destination.
- Review modes require the installed candidate/review/member identity workflow.
- `review_and_create` requires the tenant's existing formal tasks source.

These records remain project- and tenant-local. The management page does not
merge, copy, or migrate operational data between targets or tenants.

## Later extensions

An independent append-only settings audit source and rollback-history store are
not part of this version.
