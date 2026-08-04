# Install - AM-IMP-2026.0804.01

Install this package only after the claims module and Rental claim intake endpoint are ready for the same environment. Keep the tenant-level claims flag off until the integration smoke test succeeds.

## 1. Deploy shared AM code

Deploy the updated AM Platform runtime that includes the group schema, tenant configuration resolution, groups admin changes, and claims module artifact.

## 2. Prepare the target tenant schema

Run from the target AM Platform project with its own secure environment:

```text
node --env-file=.env tools/apply-group-binding-v2-schema.mjs hozo-am-2-0 --dry-run
node --env-file=.env tools/apply-group-binding-v2-schema.mjs hozo-am-2-0
```

The additive schema update creates `請款送件權限` and `請款指定送件人` if they do not yet exist. Do not copy a group row, member map, or any ID from another tenant.

## 3. Configure the secure environment

Set these names in the target service only. Use independently generated high-entropy values for the two machine tokens.

```text
HZ2_CLAIMS_LIFF_ID=<LIFF app id>
HZ2_RENTAL_BASE_URL=<Rental service URL>
HZ2_RENTAL_CLAIMS_TOKEN=<AM-to-Rental token>
HZ2_RENTAL_EVENT_TOKEN=<Rental-to-AM event token>
```

The browser receives neither token. The AM-to-Rental token is sent only by the AM server. The Rental-to-AM token is accepted only on the dedicated machine event route supplied by the claims module.

## 4. Configure one source group

1. Open `/groups?tenant=hozo-am-2-0` with a tenant-all administrator.
2. Refresh the source group's member map.
3. Set the group status to `啟用`.
4. Add `請款` to `啟用功能`.
5. Set `請款送件權限` to `指定成員`.
6. Select the permitted submitters from the group member picker and save.

The administrator interface writes only the selected stable LINE user IDs. It rejects stale, browser-injected, or cross-group IDs.

## 5. Enable only after integration verification

After LIFF identity, Rental intake, and the outbound event callback all pass in the target environment, set the target tenant's `config.claims.enabled` to `true` through the reviewed tenant configuration deployment. The default is `false`; no binding can activate claims by itself.

Update the project-local manifest and add the project-local upgrade record only after local verification. Production deployment is performed from the project service, not AMCore.
