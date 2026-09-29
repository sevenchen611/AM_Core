# Installation

1. Review and merge the feature commit into the root runtime's `main` before production deployment. Preserve the existing IO and directory client definitions and credentials.
2. From the approved checkout, run `node tools/install-line-bindings.mjs` with deployment-owned `LINE_BINDINGS_MIGRATION_DATABASE_URL` and `LINE_BINDINGS_RUNTIME_ROLE`. The migration administrator must be able to grant usage, DML and bounded IO cleanup permissions. Existing event RLS must still permit the configured target tenant. Do not export live database rows to AMCore.
3. On the existing UOF transport client, enable `allowPersonalBindings:true`, retain `transportOnly:true`, all three IO scopes and existing static group IDs. The configuration validator rejects a management target missing these protections.
4. Generate a new random management key of at least 32 characters in deployment secret storage. Add a client with its own unique `id`, the same `tenantKey`, its `tokenEnv`, `groupIds:[]`, `scopes:["bindings:write"]`, and `bindingTargetClientId` pointing to the UOF IO client. Do not reuse the IO or directory key.
5. Set `AMCORE_LINE_BINDINGS_ENABLED=1`. Optionally set `AMCORE_LINE_BINDING_OA_FRIEND_URL` to the verified OA friend URL. All keys are server-only. Restart the reviewed root runtime without changing the OA webhook.
6. Transfer only the new management key to the UOF backend's private configuration, never HTML/browser storage. Complete VERIFY before enabling the application's pilot.

First startup fails if the schema or configured client target is missing. Cleanup runs at most hourly while the feature is active: personal event copies and that target client's send/audit records older than 90 days are removed; terminal binding rows older than 90 days are removed. Active binding metadata is retained for authorization. Native UOF records and LINE chat history are unaffected.
