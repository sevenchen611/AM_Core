# Install

1. Back up the Engineering AM PostgreSQL database.
2. Apply `schemas/engineering-contract-party-a-dual-signing-v7.sql` with the
   restricted runtime role passed as `runtime_role`.
3. Deploy the runtime changes from this package to the Engineering AM service.
4. Run the checks in `VERIFY.md`.
5. Update the engineering project manifest only after local and production
   verification report the actual installed state.

The migration removes any reusable asset references from existing individual
Party A profile rows. It does not alter company large-seal assets or any
previously completed contract evidence.
