# Required databases — AM-IMP-2026.0721.02

This version adds two Portal-local Cloudflare D1 tables. It does not add a
shared database and does not change the tenant's Notion Meeting or task data
sources.

Use `schemas/portal-sso-d1.sql` as the portable additive schema reference. A
Portal implementation may create the same schema through idempotent runtime
`ensure` logic.

## 1. `am_sso_handoffs`

Purpose: one-time, short-lived exchange from an authenticated Portal account to
AM Platform.

| Column | D1 type | Requirement |
| --- | --- | --- |
| `token_hash` | `TEXT` | Primary key; SHA-256 URL-safe Base64 hash only. |
| `tenant_key` | `TEXT` | Required tenant binding. |
| `user_id` | `TEXT` | Required Portal user binding. |
| `next_path` | `TEXT` | Required; defaults to empty string; safe local return candidate. |
| `created_at` | `TEXT` | Required creation timestamp. |
| `expires_at` | `TEXT` | Required fixed expiry timestamp. |
| `consumed_at` | `TEXT` | Required; empty until consumed. |

Required index:

- `idx_am_sso_handoffs_expiry` on `(expires_at, consumed_at)`

Lifecycle:

- fixed handoff lifetime: 60 seconds;
- consume must match token hash and tenant key;
- consume must require `consumed_at = ''` and `expires_at > now`;
- consume must use a conditional update and accept success only when exactly one
  row changed;
- success writes `consumed_at`;
- replay, wrong tenant, unknown hash, and expiry are denied.

## 2. `am_sso_sessions`

Purpose: opaque Portal-backed AM session verified on every protected request.

| Column | D1 type | Requirement |
| --- | --- | --- |
| `token_hash` | `TEXT` | Primary key; SHA-256 URL-safe Base64 hash only. |
| `tenant_key` | `TEXT` | Required tenant binding. |
| `user_id` | `TEXT` | Required Portal user binding. |
| `created_at` | `TEXT` | Required creation timestamp. |
| `expires_at` | `TEXT` | Required fixed expiry timestamp. |
| `last_verified_at` | `TEXT` | Required; empty until first successful verification. |

Required index:

- `idx_am_sso_sessions_expiry` on `(expires_at)`

Lifecycle:

- fixed session lifetime: eight hours;
- verify must match token hash and tenant key and require `expires_at > now`;
- verify reloads the current user and accepts only an active user who still has
  current authority for the requested tenant;
- success updates `last_verified_at` only;
- verification does not move or extend `expires_at`.

## 3. Existing Portal account source

The existing `admin_users` source remains the authority for active state, role,
AM tenant access, and authorization version. This package does not copy or seed
users. It requires the authorization fields installed by
`AM-IMP-2026.0717.04` and fixes Portal user creation so the full create form,
including AM tenant feature selections, is persisted.

## 4. Logical expiry and optional cleanup

The runtime must exclude expired or consumed rows from every authorization
decision even if those rows still exist physically.

This version does **not** require an automatic purge job. An installation may
periodically delete:

- handoffs where `expires_at <= now` or `consumed_at <> ''`;
- sessions where `expires_at <= now`.

Cleanup is operational hygiene, not the security boundary. Never delete active
sessions by broad tenant-less criteria, and never copy any SSO row into another
environment.

## 5. Existing Meeting data

Meeting management continues to use each tenant's project-local Group Bindings
and Meeting sources defined by `AM-IMP-2026.0721.01`. This package creates no
new Notion source and must not rewrite group modes, Meeting records, review
sessions, or formal tasks.

