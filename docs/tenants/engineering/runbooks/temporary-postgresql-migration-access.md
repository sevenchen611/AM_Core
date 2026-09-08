# Engineering PostgreSQL temporary migration access

Use this runbook when an Engineering AM change needs PostgreSQL **schema** authority: creating or altering tables, columns, indexes, policies, functions, triggers, or grants. It is not required for normal application deployment or for normal reads and writes through the restricted runtime role.

This is a project-local operational runbook. It intentionally contains no database URLs, passwords, host names, user names, or other secret values.

## Principle

Keep the production service on its least-privileged runtime database role. Grant owner-level access only for one reviewed migration, prove the result, and remove the elevated path immediately afterwards. Do not replace, delete, or recreate the existing database owner, database, schema, or contract data to obtain migration access.

## When this runbook is required

Use it when the release includes one or more of the following:

- `CREATE`, `ALTER`, or `DROP` of schema objects;
- changes to row-level security (RLS), policies, ownership, roles, or grants;
- database functions, triggers, or indexes; or
- a versioned schema migration supplied by an Engineering upgrade package.

Do not use it merely to deploy JavaScript/application code or to create normal contract, payment, acceptance, or task records through the application.

## Preconditions

1. The migration is versioned in an upgrade package and has a reviewed `VERIFY.md` and `ROLLBACK.md`.
2. Run package and relevant dry-run checks locally. Use fail-fast execution (`ON_ERROR_STOP`) in production.
3. Record the exact intended schema objects, the target tenant, and whether the migration is additive or destructive. Destructive changes require an explicit backup and separate approval.
4. Confirm the owner of the Render PostgreSQL workspace can grant temporary database-management access to the account performing the release.
5. Decide the expiry/cleanup owner before access is created.

## Safe temporary-access procedure

1. **Obtain access without sharing a permanent secret.** The Render workspace owner shares the database-management capability with the authorised account, or creates a new temporary, owner-scoped credential specifically for this migration. Never put the credential in Git, a Markdown file, chat output, or a long-lived local `.env` file.
2. **Limit the path.** Attach the temporary credential only as a private, temporary service environment variable (for example `*_DATABASE_MIGRATION_URL`) or use it directly in a controlled shell. It must point to the intended Engineering database, not a similarly named default database.
3. **Grant only the minimum bridge required.** If the temporary principal must assume the Engineering owner role, grant only the necessary database `CONNECT` and role-assumption capability. Preserve all pre-existing owner membership and attributes; never broaden the runtime role.
4. **Apply exactly the reviewed package.** Use a non-interactive, fail-fast command with the explicit runtime-role variable required by the package. Do not run ad-hoc schema statements or use the runtime connection as an owner.
5. **Verify before cleanup.** With the restricted runtime role and the intended tenant context, make read-only checks for required tables/columns/functions, RLS enabled and forced where required, runtime privileges and tenant policies, expected empty/new business-operation tables, and absence of unintended contract, signing, payment, acceptance, task, LINE, or Notion changes.
6. **Remove every temporary path.** Revoke the temporary database `CONNECT` and role-assumption grants using the exact grantor/path that was added. Then delete the temporary Render environment variable and redeploy the service so it cannot remain in a running instance.
7. **Prove cleanup.** Confirm that the temporary environment variable is absent from the service, the temporary principal can no longer connect or assume the owner role, and the restricted runtime role still passes the read-only verification.

## Failure and rollback rules

- If fail-fast execution stops before commit, inspect the error and do not retry with broader permissions or a different target database.
- If a migration commits partially, follow that package's `ROLLBACK.md`; do not delete unrelated owner roles, databases, schemas, or existing contract records as a shortcut.
- If a missing privilege blocks the migration, request the smallest additional temporary capability from the database/workspace owner, then repeat the preflight and verification steps.
- If identity, database target, migration scope, or rollback safety is unclear, stop and request clarification before making any production change.

## Release evidence to record

Add a concise entry to the Engineering upgrade record and improvement manifest:

- package/version and commit or PR;
- migration timestamp and authorised operator;
- schema objects verified and runtime/RLS result;
- confirmation that no business records were changed, when applicable; and
- confirmation that temporary database grants and Render secret were removed.

## Proven reference

This procedure was used successfully for Engineering packages `AM-IMP-2026.0903.04` and `.05` on 2026-09-08. See the associated deployment record in `../upgrades/AM-IMP-2026.0903-engineering-contract-control-center.md`.
