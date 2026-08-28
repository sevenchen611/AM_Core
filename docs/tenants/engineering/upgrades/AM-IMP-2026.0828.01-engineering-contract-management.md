# AM-IMP-2026.0828.01 — Engineering contract management

Tenant: `engineering`  
Runtime target: `AM_PLATFORM`  
Status: Ready

## Prepared and verified

As of 2026-08-28, the shared runtime implementation and graphical Engineering
AM contract workspace are deployed behind a disabled signing gate. Preparation
completed without committing production identifiers, credentials, contract
records, customer information, or signing tokens:

- A separate logical Engineering contract database and owner/runtime roles were
  provisioned on the existing PostgreSQL instance.
- Schema version `2026-08-28.engineering-contract-evidence.v2` was applied in
  production. The independent contract-template and template-version tables
  were observed alongside the original eleven evidence tables, and the runtime
  role's restricted `SELECT`/`INSERT` plus narrow aggregate `UPDATE` privileges
  were verified. Temporary migration-role membership was removed afterward.
- The runtime role can use required mutable workflow operations and append
  immutable evidence, but cannot own or alter the schema, truncate evidence,
  disable triggers, or update/delete immutable signing records.
- The runtime database connection passed `verify-full` TLS checks, including
  rejection of an untrusted CA and hostname mismatch.
- The production Render service now uses the private PostgreSQL endpoint with
  the exact self-signed certificate and SHA-256 certificate pin. The restricted
  runtime role reached the expected logical database and schema from the live
  service. The project owner elected to retain the existing fixed runtime
  password; no password value is recorded here.
- Existing Notion contract properties and rows were preserved while the
  package's additive electronic-signing projection fields were added.
- The Engineering Drive contract folder passed a disposable upload and
  download/hash comparison. Its verification artifact was intentionally
  retained; sharing permissions were not broadened.
- A dedicated Engineering contract LIFF application was created in the existing
  HOZO LINE Login channel. Its Full-size endpoint, `openid` and `profile`
  scopes, disabled add-friend option, and exact HTTPS signer endpoint were
  verified. The LIFF ID is configured only in Render and is not committed here.
- Render trusted-proxy settings are deployed, and the production contract
  workspace no longer reports missing database or LIFF configuration.
- The graphical workspace includes one cross-project contract version library.
  A basic contract may be created before its attachments are complete; each
  later document or terms revision is saved as a new V1/V2/V3 entry without
  overwriting prior versions. Incomplete drafts remain visibly blocked from the
  review/signing controls.
- The contract template version library is independent from project contracts.
  Staff can upload a standard mudwork, demolition, plumbing/electrical, or
  carpentry contract as template V1/V2/V3 without selecting a project or
  counterparty. A project contract may later copy one exact template version
  into its own immutable signing snapshot.
- The production UI was verified to show "新增合約範本 V1" with type, name,
  effective date, description, version notes, and contract-body upload fields.
  It contains no project or vendor selector and the previous "新增合約並建立
  V1" action is absent. No test template or project contract was created.
- A full Render PostgreSQL export completed successfully. The export URL and
  database credentials are not recorded here.
- The production PDF renderer rejected a missing idempotency key and generated
  a PDF whose response SHA-256 matched the downloaded bytes.
- Package, contract dry-run, core, and Engineering convergence checks passed
  during implementation.

## Remaining activation checks

Signing remains disabled. The following checks still require production-local
evidence before this target can move beyond `Ready`:

1. Verify the exact trusted proxy hop and overwritten client-IP header on a
   deployed request.
2. Complete a disposable backup restore/hash drill.
3. Run one controlled non-production contract through the active project LINE
   group with exactly one designated signer, including wrong-member and revoked
   token denial checks.
4. Reconcile PostgreSQL, PDF, receipt, Drive hashes, Notion projection, and
   budget projection, then obtain project-owner acceptance.

Only after those gates pass may signing be enabled and the record advance to
`Installed`. `Deployed` additionally requires project-owner verification of the
controlled production signing flow and its evidence package.

## Rollback posture

While signing is disabled, rollback is limited to keeping the contract routes
unavailable for issuance, stopping outbox workers, and retaining PostgreSQL and
Drive evidence. Never delete immutable evidence or overwrite an issued version.
Follow the package `ROLLBACK.md` for any later pilot rollback.
