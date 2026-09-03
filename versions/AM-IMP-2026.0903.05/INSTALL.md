# Install

1. Review the package with the Engineering project owner; acceptance and
   financial closure are sensitive operations.
2. Deploy the application code that wires the acceptance service to an
   authorized, tenant-scoped repository.
3. Run the acceptance SQL schema against the dedicated Engineering contract
   PostgreSQL database as the schema owner, passing the restricted runtime role
   as runtime_role.
4. Implement repository appendAcceptanceEvent as an atomic transaction: lock
   the latest event for the frozen version, verify expected sequence/hash, then
   insert once.
5. Map server-side roles deliberately: engineering_acceptance_submitter,
   engineering_acceptance_reviewer, and engineering_acceptance_approver. Do
   not accept any role from the browser.
6. Keep all existing secrets, contract snapshots, evidence records, and
   production project data unchanged.

This migration does not update schema_meta; the contract-store compatibility
gate remains owned by the parent control-center migration.
