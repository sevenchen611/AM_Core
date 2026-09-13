# Install

1. Confirm deployed AM/Rental SHAs and the frozen Finance Claims V3 contract.
2. Apply `config/claims-authority-registry.sql` as the database owner. It creates
   the `am_claims_*` NOLOGIN roles; grant each role only to its corresponding,
   separate project-local database login.
3. Construct `createClaimsAuthorityPostgresStore` with separate tenant,
   discovery-writer, platform-owner, and worker pools. Production must not use
   one login that can assume all four roles.
4. Provide one fixed `<PREFIX>_CLAIMS_AUTHORITY_IDENTITY_KEY` of at least 32
   bytes. Do not add a key-version or rotation setting.
5. Create `createClaimsAuthority({ store, identityKey, financeProvisioner, openV3Claim })`.
6. Route all LINE group lifecycle/message webhooks through `handleEvent` after
   signature verification. Unbound events enter the platform discovery pool;
   they never gain tenant authority from the webhook itself.
7. Mount `createClaimsAuthorityAdminHandler` behind the existing authenticated
   admin session. Provide server-side `resolveContext`, `listTargets`,
   `resolveTarget`, and a
   CSRF-enforcing `verifyMutation` callback.
8. Run `createClaimsAuthorityOutboxWorker(...).runOnce()` from the project-local
   worker. The dispatcher must use existing idempotent V3 notification paths.
9. Start in shadow mode before enforce mode:

```json
{
  "claims": {
    "authorityRegistry": { "mode": "shadow" }
  }
}
```

Do not put database URLs, LINE IDs, member names, or tenant records in this package.

Required runtime imports:

```js
import { createClaimsAuthority } from './core/claims-authority.js';
import { createClaimsAuthorityAdminHandler } from './core/claims-authority-admin.js';
import { createClaimsAuthorityOutboxWorker } from './core/claims-authority-outbox.js';
import { createClaimsAuthorityPostgresStore } from './core/claims-authority-postgres.js';
import { createClaimsAuthorityRuntimeAdapter } from './core/claims-authority-runtime.js';
import { createClaimsAuthorityV3Adapter } from './core/claims-authority-v3.js';
```
