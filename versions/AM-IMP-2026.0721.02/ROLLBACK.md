# Rollback — AM-IMP-2026.0721.02

Rollback must preserve tenant isolation and must not replace SSO with a public
Meeting management route.

## Immediate containment

1. Hide or disable the Portal Meeting management entry.
2. Keep `/meetings/manage` protected; do not change it to a public route.
3. If authorization behavior is uncertain, use the existing `owner-only`
   authorization safety mode rather than granting tenant-wide fallback access.
4. Keep routine emergency-PIN login disabled.

## AM Platform rollback

1. Roll back the AM Platform deployment to the last verified release.
2. Remove the friendly denied-handler exception only together with the route
   version that understands it. The prior behavior may return JSON denial, but
   must still deny unauthorized access.
3. Keep safe return handling or fall back to the tenant home route. Never restore
   arbitrary `next` redirects.
4. Remove the target's Portal service credential from AM Platform only after
   traffic is no longer using the new SSO flow.

## Portal rollback

1. Roll back the Portal project entry and SSO endpoints to the last verified
   release.
2. Stop issuing new handoffs before disabling consume/verify endpoints.
3. Rotate the Portal/AM service credential if token exposure or endpoint misuse
   is suspected; update each target independently.
4. Let already-issued fixed-lifetime sessions expire or explicitly purge only
   the target's affected session hashes.

## D1 rollback

Do not drop `am_sso_handoffs` or `am_sso_sessions` during an incident rollback.
They are additive and contain only hashes plus tenant/user references and
timestamps. Dropping them is not required to disable the code and can destroy
useful audit evidence.

After traffic is stopped, an authorized operator may delete:

- consumed or expired handoffs;
- expired sessions;
- specifically identified active session hashes during incident revocation.

Do not run a broad delete without a reviewed target and recovery plan.

## Meeting settings and business data

This package does not migrate Meeting data. Leave Group Binding rollout modes,
Meeting records, candidate todos, confirmations, and formal tasks unchanged.
Do not copy or restore these records from another tenant or project.

## Re-enable

Before reinstalling:

1. verify D1 schema and indexes;
2. verify matching server-to-server authentication without printing values;
3. rerun replay, wrong-tenant, expiry, live revocation, safe return, friendly
   denial, and selected-group rejection checks;
4. restore the Portal entry only after both deployments pass;
5. update each target manifest independently.

