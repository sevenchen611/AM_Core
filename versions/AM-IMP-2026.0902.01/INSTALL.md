# Install

1. Deploy the application changes to the Engineering AM service.
2. Run `schemas/engineering-contract-line-archive-v5.sql` against the dedicated Engineering contract PostgreSQL database as the schema owner, passing the restricted runtime role as `runtime_role`.
3. Keep the existing database password and secrets unchanged.
4. Verify the schema version and revoke any temporary migration membership.
5. From the authenticated contract workspace, upload an approved historical evidence PDF through `補充早期 LINE 對話證據`.
