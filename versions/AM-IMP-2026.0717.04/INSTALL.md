# Install — AM-IMP-2026.0717.04

Install each target separately. Do not copy project data, Notion IDs, sessions, or secrets between projects.

## 1. AM Platform / Core

1. Apply `core/access.js`, Portal live verification, route access declarations, and module guards from this AMCore version.
2. Configure the Core service:

```text
AMCORE_PORTAL_SERVICE_TOKEN=<same high-entropy value as Portal AM_PLATFORM_SERVICE_TOKEN>
AMCORE_PORTAL_ME_ENDPOINT=https://rental.hozorental.com/api/me
AMCORE_PORTAL_HANDOFF_ENDPOINT=https://rental.hozorental.com/api/am-sso/consume
AMCORE_PORTAL_VERIFY_ENDPOINT=https://rental.hozorental.com/api/am-sso/verify
AMCORE_GROUP_AUTHZ_MODE=shadow
AMCORE_ENABLE_EMERGENCY_PIN=0
AMCORE_EMERGENCY_PIN_TTL_SECONDS=900
```

3. Do not switch to `enforce` yet.

## 2. Portal

1. Apply the Portal worker and account-page changes in its own repository.
2. Configure:

```text
AM_PLATFORM_BASE_URL=https://<current-am-platform-host>
AM_PLATFORM_SERVICE_TOKEN=<same value as Core AMCORE_PORTAL_SERVICE_TOKEN>
AM_GROUP_AUTHZ_MODE=shadow
```

3. On first authenticated account API call, `ensureAuthSchema()` additively creates `am_access`, `authz_version`, and `am_authz_audit`.
4. Confirm the account page loads tenants/groups through `/api/am-access-directory`. The browser must never receive the service token.

## 3. Prepare owner review (no automatic permission writes)

Export a password-free Portal user JSON and a server-side AM directory JSON into the Portal project's secured local workspace. Then run:

```text
node versions/AM-IMP-2026.0717.04/scripts/plan-account-review.mjs --users <users.json> --directory <directory.json> --engineering-map <optional-map.json> --out <review.json>
```

The result is a candidate list only. The platform owner must choose `all` or explicit groups in the Portal UI and save each account. Principal-owner suggestions do not auto-grant access.

## 4. Prepare old task/message assignment

Build a project-local input containing only record IDs and reliable source relation IDs, then run:

```text
node versions/AM-IMP-2026.0717.04/scripts/plan-group-backfill.mjs --input <records.json> --out <backfill-plan.json>
```

Apply only `decision=backfill` rows after owner review. Keep conflicts and no-evidence rows unassigned. Never infer by group name.

## 5. Rollout sequence

1. Forest four groups in shadow mode.
2. Engineering tenant.
3. HOZO_AM and SevenAM separately, using their own project data and manifests.
4. Verify every existing AM account has reviewed `amAccess`.
5. Set both Core and Portal `AM*_GROUP_AUTHZ_MODE=enforce`.
6. Keep routine PIN disabled.

Do not change the single LINE OA webhook during account migration. Deployment and production verification are performed from each target project's own repository/service.
