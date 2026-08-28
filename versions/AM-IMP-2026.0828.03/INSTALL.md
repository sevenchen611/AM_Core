# Install — AM-IMP-2026.0828.03

1. Deploy the updated `modules/groups`, onboarding core, and server runtime.
2. Apply the additive group-binding V2 schema to the target tenant:

   `node tools/apply-group-binding-v2-schema.mjs <tenant-key>`

3. Open the tenant group console and run member synchronization.
4. For an unverified LINE Official Account, have every member who must be selectable send one message in the group. AM records the webhook user ID automatically.
5. Re-running the tenant onboarding command also records the command sender while preserving existing members.

Do not copy a member map or LINE user ID between tenants or groups.
