# AM-IMP-2026.0717.04 — Tenant-to-group authorization

Status: **Ready**

This package defines and implements the AM Platform authorization chain:

```text
personal Portal account → tenant → conversation group → module action → per-tenant Notion guard
```

It closes the prior tenant-wide access gap for group settings, queue messages/photos, tasks, and group-owned construction tickets. Project-only budget and contract permissions remain separate.

## Included contract

- Portal `admin_users.am_access` and `authz_version=3`.
- `mode=all` for all current/future tenant groups; `mode=selected` for explicit group-binding Notion Page IDs.
- Permission-change audit table `am_authz_audit`.
- Server-protected AM tenant/group directory with no LINE IDs, member maps, or secrets.
- Opaque AM session handles; Core asks Portal for the current user on every backend request.
- Core `AccessContext` and fail-closed `public | machine | tenant | group` module routes.
- Per-record relation checks before Notion PATCH, batch operations, or attachment/Drive access.
- System-principal behavior for webhook/scheduler work, still constrained by the tenant Notion guard.
- Shadow → owner review → enforce rollout, with `owner-only` as the safe rollback mode.
- Migration-pending AM systems stay visible in the directory but are non-assignable and do not start webhook modules or schedulers.

## Files

- `config/access-contract.json` — machine-readable policy summary.
- `schemas/portal-admin-users.sql` — additive Portal schema reference.
- `scripts/plan-account-review.mjs` — creates review-only candidates from legacy AM entry/scope permissions.
- `scripts/plan-group-backfill.mjs` — creates evidence-based responsible-group backfill plans; never guesses by name.
- `tools/audit-module-authorization.mjs` — verifies authorization coverage for every enabled AM Platform module and system principal injection.
- `INSTALL.md`, `VERIFY.md`, `ROLLBACK.md` — rollout and safety procedure.

## Data boundary

This package contains no Portal accounts, customer messages, Notion IDs, LINE IDs, tokens, or production records. Candidate and backfill outputs must remain in each project-local secured workspace and must not be committed to AMCore.
