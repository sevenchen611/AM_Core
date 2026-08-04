# AM-IMP-2026.0804.01 - Claims group governance

## Outcome

This package adds the tenant-local governance required before a LINE group can submit a financial claim. It supplies the group capability, designated-submitter fields, and runtime configuration contract for the separate `claims` module.

The package does not submit claims, create payables, push LINE messages, or contain any tenant data. Those runtime behaviors belong to the claims module and the Rental finance service.

## Authority contract

A claims module may accept a request only when all conditions are true:

1. `tenant.config.claims.enabled === true`.
2. The resolved group binding status is `啟用`.
3. The binding `啟用功能` includes `請款`.
4. The binding `請款送件權限` is `指定成員`.
5. The LINE sender user ID exists in the JSON array stored in `請款指定送件人`.
6. Every stored sender ID is validated against the same binding's `成員對照` map when an administrator saves it.

The member map remains a display-name-to-LINE-user-ID map. The new allowlist stores only the stable LINE user IDs, for example:

```json
["Uxxxxxxxx"]
```

Changing a LINE group display name or a member display name does not grant or remove claim authority. If a member map refresh removes a configured user ID, the next claims request must fail closed until a tenant administrator reviews the allowlist.

## Runtime configuration contract

The tenant configuration is non-secret and starts disabled:

```json
{
  "claims": {
    "enabled": false,
    "requireActiveBinding": true,
    "requireClaimCapability": true,
    "requireNamedSubmitter": true
  }
}
```

At runtime, `core/tenants.js` resolves these values into `tenant.config.claims` from the active tenant prefix:

| Runtime property | Environment variable | Direction |
| --- | --- | --- |
| `liffId` | `<PREFIX>_CLAIMS_LIFF_ID` | LINE LIFF identity |
| `rentalBaseUrl` | `<PREFIX>_RENTAL_BASE_URL` | AM to Rental base URL |
| `rentalClaimsToken` | `<PREFIX>_RENTAL_CLAIMS_TOKEN` | AM to Rental machine authentication |
| `rentalEventToken` | `<PREFIX>_RENTAL_EVENT_TOKEN` | Rental to AM event authentication |

No value is committed to this package, tenant JSON, health output, or browser payload.

## Agent 1 integration shape

The claims module must treat these fields as its configuration and binding contract:

```text
tenant.config.claims.enabled
tenant.config.claims.liffId
tenant.config.claims.rentalBaseUrl
tenant.config.claims.rentalClaimsToken
tenant.config.claims.rentalEventToken

ctx.binding.pageId
ctx.binding.status
ctx.binding.capabilities
ctx.binding.members
```

Because `ctx.binding` remains a minimal routing object, Agent 1 must read `請款送件權限` and `請款指定送件人` from the resolved tenant-local binding page before issuing a LIFF link or submitting a claim. It must not infer authority from `ctx.binding.groupName` or accept a raw LINE group ID from a browser request.

## Data boundary

Do not place LINE group IDs, member maps, names, claim records, supplier data, Rental URLs, tokens, or production IDs in AMCore package files. Configure all values in the target project's secure environment and tenant-local data source.
