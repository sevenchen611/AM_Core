# AM-IMP-2026.0721.02 — Portal SSO and tenant-safe Meeting administration

Status: **Ready**

Depends on:

- `AM-IMP-2026.0717.04` — Portal identity and tenant-to-group authorization
- `AM-IMP-2026.0721.01` — Meeting Rollout Control Center

This package completes the protected path from HOZO Portal to the AM Platform
Meeting management console. It replaces cross-domain login assumptions with a
short-lived, single-use handoff and an opaque AM session, gives denied browser
requests a useful HTML login page, and keeps the Meeting console restricted to
platform owners.

The package is portable code and schema only. Portal accounts, D1 rows, tenant
settings, LINE identities, Notion records, credentials, and deployment state
remain local to each installation.

## Outcome

```text
Portal platform owner
  -> Portal verifies active owner account
  -> Portal creates 60-second, single-use handoff in D1
  -> AM Platform consumes handoff through service authentication
  -> AM Platform stores only an opaque signed session handle in HttpOnly cookie
  -> every protected request re-verifies the current Portal user and tenant
  -> platform owner opens /meetings/manage for that tenant
```

Directly opening a protected HTML console without a valid session no longer
ends at a raw JSON error. The exact page request may reach its handler with a
denied access context solely to render a friendly login page. Protected API
subpaths still stop at the central authorization gate with `401` or `403`.

## Included scope

### Portal to AM Platform SSO

- Portal endpoints start, consume, and verify an AM SSO exchange.
- The handoff is short-lived, tenant-bound, and consumable exactly once.
- The resulting AM session is opaque, tenant-bound, fixed-lifetime, and checked
  against the current active Portal account on every verification.
- Portal and AM Platform authenticate server-to-server calls with a shared
  service credential configured independently in their deployment systems.
- Raw handoff and session tokens are never stored in D1; only SHA-256 hashes are
  persisted.

### Friendly protected-page behavior

- The Meeting management page can render a friendly Portal-login page for an
  unauthenticated exact `GET /meetings/manage` request.
- An authenticated user without platform-owner Meeting management authority gets
  a friendly `403` page instead of the global console.
- JSON APIs never inherit the HTML exception and remain fail closed.

### Platform-level Meeting management authority

- The management route is a tenant administration route, not an ordinary
  selected-group route.
- Only a platform owner (`isPlatformOwner`) may list the full tenant roster,
  run preflight, initialize Meeting fields, or apply Meeting modes.
- A platform owner may switch among authorized Meeting tenants.
- Browser hiding is not authorization; every backend endpoint repeats the
  platform-owner check before reading or changing the console data.

### Safe return path

After SSO, AM Platform accepts only an allowlisted local path. The current
allowlist is:

- `/meetings/manage`
- `/admin`

Protocol-relative URLs, absolute URLs, backslashes, and any other path fall
back to the tenant's normal home route. AM Platform overwrites the `tenant`
query parameter with the tenant that was actually consumed, preventing a return
URL from switching tenant context.

### Portal D1 persistence

Two additive D1 tables are required:

- `am_sso_handoffs` — hashed one-time exchange tokens, tenant/user binding,
  safe return path, expiry, and consumption time;
- `am_sso_sessions` — hashed opaque sessions, tenant/user binding, fixed expiry,
  and last verification time.

The schema and lifecycle are documented in `REQUIRED_DATABASES.md` and provided
as `schemas/portal-sso-d1.sql`.

## Security invariants

- Missing Portal service authentication fails closed; it never falls back to a
  public Meeting console.
- A handoff cannot be replayed, consumed under another tenant, or used after its
  expiry.
- Session verification does not slide the eight-hour expiry.
- Disabling an account or changing its current authorization affects the next
  verification.
- Selected-group or tenant-wide non-owner access is insufficient for the Meeting
  console.
- Safe return validation is performed by AM Platform even if Portal already
  validated the requested destination.
- The browser never receives a service credential, token hash, LINE token,
  Notion token, or D1 management credential.

## Compatibility and rollout

This package does not change per-group Meeting modes or create formal tasks. It
only protects and opens the management path defined by
`AM-IMP-2026.0721.01`. Existing group rollout settings remain unchanged.

Deploy the Portal D1 schema and SSO endpoints first, then configure both sides'
service authentication, then deploy AM Platform. Do not mark a target
`Deployed` until a real Portal account has completed start, consume, safe
return, live verification, and platform-owner Meeting authorization checks.

## Not included

- copying Portal users or sessions between environments;
- copying Meeting, LINE, Notion, or task data between tenants;
- converting selected-group users into tenant-wide managers;
- granting non-owner users access to the Meeting management console;
- a general-purpose redirect service or arbitrary `next` URL;
- automatic physical deletion of expired D1 rows;
- emergency PIN enablement as a routine login path.
