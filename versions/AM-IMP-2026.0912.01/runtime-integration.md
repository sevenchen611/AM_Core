# Runtime integration contract

```js
import { createClaimsAuthority } from './core/claims-authority.js';
import { createClaimsAuthorityAdminHandler } from './core/claims-authority-admin.js';
import { createClaimsAuthorityOutboxWorker } from './core/claims-authority-outbox.js';
import { createClaimsAuthorityPostgresStore } from './core/claims-authority-postgres.js';
import { createClaimsAuthorityRuntimeAdapter } from './core/claims-authority-runtime.js';
import { createClaimsAuthorityV3Adapter } from './core/claims-authority-v3.js';

const store = createClaimsAuthorityPostgresStore({ tenantPool, discoveryPool, platformPool, workerPool });
const v3 = createClaimsAuthorityV3Adapter({
  groupEntry: localFinanceV3GroupEntry,
  verifySource,
  resolveApplicantReference,
  syncMembership,
});
platform.claimsAuthority = createClaimsAuthority({
  store,
  identityKey,
  financeProvisioner: v3.financeProvisioner,
  openV3Claim: v3.openV3Claim,
  identityResolver,
});
platform.claimsAuthorityAdmin = createClaimsAuthorityAdminHandler({
  authority: platform.claimsAuthority,
  resolveContext,
  listTargets,
  resolveTarget,
  verifyMutation,
});
platform.claimsAuthorityOutbox = createClaimsAuthorityOutboxWorker({ store, dispatcher, workerId });
platform.claimsAuthorityRuntime = createClaimsAuthorityRuntimeAdapter({
  authority: platform.claimsAuthority,
  replyLine,
});
```

On every group lifecycle and message webhook, call `handleEvent`. Unbound groups
must enter a platform-level discovery pool before explicit tenant assignment.
The callback `openV3Claim` is the existing V3 queue/lease/idempotent link path.

For a claims command from an unbound group, reply only with: `此群尚未完成請款授權設定，請管理者完成群組綁定後再試。`
For a missing LINE user identity, reply only with: `目前無法安全確認你的請款身份，請在已啟用請款的群組重新傳送指令，或聯絡管理者。`

Use `isClaimsCommand(message.text)` for those fallbacks. Never create a task,
claim, or registry grant from either fallback path.

`openV3Claim` receives the event fingerprint as `idempotencyKey`. It must call
the existing Finance V3 applicant-bound, ten-minute link flow; do not create a
parallel claim form. Run the authority before legacy explicit-submitter checks
when registry mode is `enforce`, while retaining `off` as rollback behavior.

The administration handler is framework-neutral and returns
`{ status, headers, body }`. Adapt that object to the target runtime response.
The page may show encrypted-at-rest LINE display names to authorized admins and
uses opaque lookup prefixes as fallback; raw LINE IDs remain encrypted on the
server. Display names are never authorization keys. Tenant/Finance targets are
resolved server-side, and platform discovery is visible only to
`platform_owner`.

The fixed key decision is deliberate: use exactly one secret value and the
`fixed-v1` ciphertext marker. There is no online rotation path.
