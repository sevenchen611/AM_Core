# Install

1. Apply `schemas/engineering-contract-party-a-online-signing-v8.sql` to the
   Engineering contract PostgreSQL database with the restricted runtime role
   available to the existing schema migration process.
2. Deploy the changed contract runtime, public signing page, workflow API, and
   management workspace files listed in `upgrade.json`.
3. Confirm the contract store reports schema version
   `2026-09-02.engineering-contract-evidence.v8`.
4. For an already active individual Party A signing session, use the management
   workspace's **綁定甲方 LINE 簽署人** control once. Do not reissue the frozen
   PDF merely to add the Party A signer.

No reusable individual signature asset is created or migrated.
