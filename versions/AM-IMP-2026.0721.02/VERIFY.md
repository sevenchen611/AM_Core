# Verify — AM-IMP-2026.0721.02

Verify Portal and AM Platform independently, then verify the cross-domain flow.
Use only synthetic test accounts/tokens in local checks and the target's own
authorized accounts in production.

## 1. Package and static checks

From AMCore:

```text
node --check core/portal-handoff.js
node --check core/portal.js
node --check server.js
node --check modules/meetings/admin.js
node --check modules/meetings/index.js
node tools/verify-portal-handoff.mjs
node tools/verify-meeting-admin.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0721.02
```

Against the target Portal project:

```text
node --check _worker.js
node tools/verify-portal-group-authz.mjs <portal-project-path>
```

Also verify that the two shipped `admin-users` page variants are byte-identical
after the AM-feature persistence correction.

## 2. Portal D1 schema

Confirm the target Portal D1 database contains:

- `am_sso_handoffs` with all seven required columns;
- `idx_am_sso_handoffs_expiry` on expiry/consumption state;
- `am_sso_sessions` with all six required columns;
- `idx_am_sso_sessions_expiry` on expiry.

Run schema installation twice in a disposable/local D1 database. The second run
must succeed without replacing tables or deleting rows.

Create synthetic rows and verify raw token strings are absent; only expected
hashes may appear in `token_hash`.

## 3. Handoff behavior

1. An unauthenticated Portal request cannot start a handoff.
2. An active non-owner user cannot start a handoff.
3. An authorized platform owner receives a handoff whose fixed expiry is 60 seconds.
4. Consume succeeds once for the same tenant.
5. Immediate replay fails.
6. A wrong-tenant consume fails and does not consume the valid tenant's row.
7. An expired handoff fails.
8. Concurrent consume attempts result in exactly one success.
9. Consume and verify reject missing or incorrect service authentication.

## 4. Session behavior

1. Successful consume creates a hashed, tenant-bound session with a fixed
   eight-hour expiry.
2. Verify succeeds only for the matching tenant.
3. Successful verify updates `last_verified_at` but leaves `expires_at`
   unchanged.
4. Disabling the user makes the next verify fail.
5. Removing owner status makes the next verify fail.
6. Editing current account authorization is visible on the next verified
   request.
7. An expired session fails even when its D1 row remains present.

## 5. Safe return path

Verify the helper and the live SSO flow:

- `/meetings/manage` returns to `/meetings/manage?tenant=<consumed-tenant>`;
- `/admin` returns to `/admin?tenant=<consumed-tenant>`;
- a supplied tenant for another tenant is overwritten;
- absolute URLs, `//host/path`, backslashes, encoded bypass attempts, unknown
  paths, and malformed URLs fall back to the tenant home route;
- no response emits an external `Location` derived from untrusted `next` input.

## 6. Friendly login and API protection

1. Without a session, exact `GET /meetings/manage?tenant=<tenant>` returns a
   friendly HTML login page and no tenant roster.
2. Without a session, `/meetings/manage/api/list` remains `401` JSON.
3. With an authenticated but unauthorized account, the page and APIs return
   `403` and no roster.
4. No friendly-page exception applies to `POST`, schema, apply, preflight, or
   any nested API path.

## 7. Tenant-level Meeting authority

1. A selected-group user cannot open or query the Meeting console.
2. A tenant-wide non-owner manager cannot open or query the Meeting console.
3. A platform owner sees authorized Meeting tenant tabs and can switch tenant
   context without cross-tenant rows appearing in a response.
4. Modified browser tenant/page/group identifiers cannot read or change another
   tenant.
5. Schema initialization and batch apply still require the existing Notion
   tenant guard and server-resolved Group Binding rows.

## 8. Portal account creation regression

Create a synthetic Portal user while selecting both a Rental permission and an
AM tenant permission. Reload the account and confirm both selections persisted.
Existing-user editing must continue to preserve its current behavior.

## 9. Production smoke test

1. `/health` reports Portal service authentication configured and exposes no
   secret value.
2. Enter through the Portal Meeting management card with a real platform owner.
3. Repeat with a non-owner user and verify the friendly `403`.
4. Repeat with a selected-group user and verify `403`.
5. Revoke a test account's permission and verify the next request is denied.
6. Confirm direct unauthenticated page access is friendly HTML while API access
   remains JSON-denied.

Mark the target `Deployed` only after all applicable production checks pass.
