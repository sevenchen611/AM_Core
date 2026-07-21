# Control Contract

This contract describes the currently implemented AM Platform behavior. A
portable target may adapt storage paths, but it must preserve the mode,
authorization, tenant-isolation, and fail-closed semantics below.

## Production enum and Portal labels

```text
off               關閉        level 0
record_only       僅記錄      level 1
review_only       確認試行    level 2
review_and_create 完整確認    level 3
```

The stored Group Bindings select uses the Chinese label. Runtime normalization
accepts the production enum and supported legacy aliases. Unknown values never
silently become a higher-permission mode.

## Requested mode, legacy fallback, and tenant ceiling

1. Resolve the incoming LINE group to exactly one tenant and one Group Bindings
   row under the guarantees of `AM-IMP-2026.0720.03`.
2. If the row contains `會議待辦模式`, use that as the requested group mode.
3. If no group mode is stored, preserve legacy behavior:
   - `formalTasksEnabled=true` requests `review_and_create`;
   - `formalTasksEnabled=false` requests `record_only`.
4. Derive the current compatibility ceiling from the tenant:
   - `formalTasksEnabled=true` permits up to `review_and_create`;
   - `formalTasksEnabled=false` permits up to `review_only`.
5. Clamp the requested mode to that ceiling.
6. A disabled runtime/meetings module, disabled binding, or binding without the
   meetings capability resolves to `off`.
7. A shadow binding is clamped to `record_only`; it may preserve meeting
   evidence but cannot start identity confirmation or create formal tasks.

Portal displays both requested and effective labels and the reason when the
effective mode is downgraded. This version does not let Portal edit a tenant
default or ceiling.

## Mode behavior

### `off` / 關閉

- New media from that group does not start the meeting workflow.
- Existing meeting and task records are not deleted or rewritten.

### `record_only` / 僅記錄

- Supported meeting media enters transcription and meeting-record generation.
- The meeting record is published through the compatible existing path.
- No owner/host todo confirmation session is opened by this rollout path.
- No formal task is created by this rollout path.

### `review_only` / 確認試行

- The meeting record is produced and published.
- Editable candidate todos enter owner and host confirmation.
- The confirmed review result is retained by the installed meeting-review
  workflow, but formal tasks are not created.

### `review_and_create` / 完整確認

- The meeting record and owner/host confirmation workflow both run.
- Formal tasks are created only after the dependency confirmation gate passes.
- Existing meeting-task idempotency and source-evidence requirements remain in
  force.

## Current Preflight contract

Preflight returns `Ready`, `Warning`, or `Blocked`, plus safe operator-facing
issues. A batch containing any Blocked group is rejected before settings are
applied.

For every non-`off` request, the implementation checks configured readiness for:

- enabled tenant runtime and meetings module;
- tenant-scoped Notion Group Bindings source;
- meeting-record storage;
- transcription and AI summarization;
- LINE notification support;
- a non-empty server-read LINE group ID;
- active binding status and the `會議` capability;
- the `formalTasksEnabled` tenant ceiling;
- shadow-binding restrictions.

For `review_only` and `review_and_create`, it additionally checks:

- public base URL and signed review-link configuration;
- a configured tenant LIFF ID;
- at least one synchronized group member identity.

For `review_and_create`, it additionally checks that the tenant has a configured
formal-tasks data source.

Missing Drive backup is currently a Warning. For `record_only`, a missing public
review URL is also a Warning. Preflight checks configured readiness; it does not
publish LIFF, verify every external console state, or provision resources.

## Current Portal and mutation contract

- The page has tenant tabs and queries only the selected tenant's configured
  Group Bindings source.
- Portal access filtering determines which rows a signed-in user may list and
  Preflight.
- Schema initialization and apply require the tenant-wide group-manager flag
  `isTenantAll` and server-side `groups.core.edit` authorization.
- The browser submits only binding page IDs and requested modes. The server
  reloads authorized rows and reads the LINE group ID from those rows.
- A request may contain at most 100 unique groups.
- Apply runs Preflight for the whole selected batch. If one group is Blocked,
  no group update starts.
- Each successful row update stores the selected mode, meetings capability,
  Preflight result/note, setting schema version, last check time, and—when the
  standard fields exist—last setter and last setting time.
- After each successful row update, the router invalidates only the server-read
  LINE group ID so the next meeting uses the new setting without redeployment.
- A meeting/review session stores its effective mode when created and keeps that
  mode through the existing workflow.
- API responses and UI content do not expose LINE, Notion, signing, or other
  secret values.

This version records current metadata on each Group Bindings row. It does not
provide an independent append-only audit database or cross-page optimistic
configuration revision protocol.

## Current schema initialization boundary

The Portal can add missing meeting-management fields to the selected tenant's
existing Group Bindings source. It preserves existing select options. If an
existing field has an incompatible type, initialization stops for manual review
instead of replacing that field.

Schema initialization does not create a Group Bindings source and does not
create or configure LIFF, Render, LINE, Notion integrations/permissions,
storage, transcription, or AI services.

## Later extensions (not part of this contract version)

- editable tenant default and ceiling controls;
- independent append-only setting audit records;
- emergency-stop and pause-new-meetings controls;
- rollback-history UI;
- cross-page optimistic configuration revision checks;
- automatic external resource provisioning.
