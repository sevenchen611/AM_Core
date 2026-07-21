# Install — AM-IMP-2026.0721.02

Install Portal and AM Platform as separate targets. Do not copy any account,
session, token, D1 row, tenant permission, Group Binding, Meeting record,
credential, or deployment value between environments or business units.

## Prerequisites

1. Install and verify `AM-IMP-2026.0717.04` for Portal identity and tenant/group
   authorization.
2. Install and verify `AM-IMP-2026.0721.01` for the Meeting Rollout Control
   Center.
3. Confirm the target Portal D1 binding and target AM Platform Render service
   are the intended production pair.
4. Keep normal emergency-PIN login disabled.

## 1. Install Portal D1 schema

Apply `schemas/portal-sso-d1.sql` to the target Portal D1 database, or install
the equivalent idempotent `ensure` logic in the Portal Worker.

The operation must be additive:

- create `am_sso_handoffs` if absent;
- create `am_sso_sessions` if absent;
- create their expiry indexes if absent;
- do not replace, truncate, or copy `admin_users`;
- do not import handoff/session rows from another environment.

Verify the exact fields and lifecycle in `REQUIRED_DATABASES.md` before
deploying the Worker routes.

## 2. Install Portal SSO behavior

In the Portal project:

1. Install the authenticated AM SSO start endpoint.
2. Require an active Portal platform-owner account before issuing a handoff.
3. Generate high-entropy handoff and session tokens, return the raw token only
   through the TLS-protected exchange, and persist only its SHA-256 hash.
4. Install service-authenticated consume and verify endpoints.
5. Consume a handoff with one conditional update that checks token hash,
   tenant, unused state, and future expiry; require exactly one affected row.
6. Verify sessions against hash, tenant, and future expiry, then reload the
   current `admin_users` row and require owner status.
7. Update only `last_verified_at`; never extend the fixed session expiry.
8. Add the Meeting management entry to Portal using the SSO start flow and a
   safe Meeting-console return path.
9. In Portal user creation, collect feature selections from the entire create
   form so AM tenant permissions are not omitted. Keep the two shipped
   `admin-users` page variants identical.

Do not expose server service authentication to browser JavaScript.

## 3. Configure Portal deployment

Add the Portal-side names listed in `ENVIRONMENT.md` to that target's own
Cloudflare configuration. Generate or retrieve values only from that target's
secret manager. The Portal service token and AM Platform service token must be
the corresponding pair without printing either value.

Deploy Portal first. Confirm start, consume, and verify routes are live and the
D1 schema is ready before switching the Portal Meeting entry to the new flow.

## 4. Install AM Platform behavior

In AM Platform:

1. Install Portal handoff consumption and live session verification.
2. Store only an opaque signed local cookie containing the Portal session
   handle. Keep it `HttpOnly`, `Secure`, and `SameSite=Lax`.
3. Install `safePortalHandoffLocation` with the fixed local allowlist and
   tenant overwrite behavior.
4. Allow only the exact protected Meeting console `GET` to reach its handler
   with a denied context for friendly HTML. Keep API subpaths inside the central
   `401/403` gate.
5. Declare `/meetings/manage` as a tenant administration route.
6. Require `isPlatformOwner` for the management page and every list, preflight,
   schema, and apply endpoint.
7. Return friendly `403` for non-owner users, including tenant-wide managers.

Do not mark the route public and do not treat a browser-provided tenant or group
identifier as authorization.

## 5. Configure AM Platform deployment

Add the AM Platform-side names listed in `ENVIRONMENT.md` to that target's own
Render service. Confirm that the Portal and AM Platform service credentials are
the intended matching pair without copying values into source control or logs.

Deploy AM Platform and verify that `/health` reports Portal service
authentication configured. The health endpoint must not expose the value.

## 6. Activate the Portal entry

1. Sign in to HOZO Portal with a real active test account.
2. Start the Meeting management SSO flow from Portal; do not paste a raw Render
   URL as the normal entry path.
3. Confirm the browser returns to the allowlisted Meeting console for the same
   tenant.
4. Complete the tests in `VERIFY.md` for platform owner, non-owner user,
   selected-group user, revoked user, replay, expiry, and unsafe return paths.

## 7. Record installation status

For each target separately:

1. create or update its `docs/upgrades/AM-IMP-2026.0721.02-*.md` record;
2. update its project improvement manifest;
3. use `Installed` after local code/schema verification;
4. use `Deployed` only after the production SSO and authorization smoke tests
   pass for that target.
