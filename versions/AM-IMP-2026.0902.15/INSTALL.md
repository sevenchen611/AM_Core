# Install

1. Apply `schemas/engineering-contract-party-a-profile-constraint-v9.sql` to
   the Engineering contract PostgreSQL database using the established owner
   migration process and pass the restricted runtime role as `runtime_role`.
2. Confirm the migration commits atomically and reports schema version
   `2026-09-02.engineering-contract-evidence.v9`.
3. Revoke any temporary owner connection or role-switch grants used for the
   migration.

No runtime deployment is required for behavior; the already deployed UI and
API submit the correct identity-only individual profile payload.
